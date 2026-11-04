'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  PersonaDraftSchema,
  emptyPersonaDraft,
  defaultContentLimits,
  createPublicSnapshotSchema,
  publicSnapshotCandidate,
  type PersonaDraft,
  type Platform,
  type AuthContextResponse,
} from '@personamarket/contracts';
import {
  ArrowLeftIcon,
  EyeIcon,
  SaveIcon,
  SendIcon,
  LockKeyholeIcon,
  LoaderCircleIcon,
} from 'lucide-react';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { Alert, AlertDescription } from '@personamarket/ui/components/alert';
import { PageIntro } from '../page-layout';
import { FormNotice } from '../auth/auth-fields';
import { authQuery } from '@/lib/auth-api';
import { personasApi } from '@/lib/personas-api';
import { DraftText, EditorSection, MaiBotFields, AstrBotFields } from './draft-fields';
import { CategoryField, TagsField } from './taxonomy-fields';
import { PersonaAvatarField, personaAvatarUploadKey } from './persona-avatar-field';
import { RecommendedModelsFields } from './model-fields';
import { OriginFields } from './origin-fields';
import { PlatformField } from './platform-field';
import { ReadmeEditor } from './readme-editor';
import { AssetLibrary } from './asset-library';
import { CreatorCard } from './creator-preview';
import { DraftChecks } from './draft-checks';
import { CreatorPreviewSheet } from './creator-preview-sheet';
import { useUnsavedDraft } from './use-unsaved-draft';
import { useCreationDrafts, type CreationBuffers } from './creation-drafts';
import { creationPath, retainsCreationDraft } from '@/lib/creation-auth-return';

const emptyBuffers = (): CreationBuffers => ({
  maibot: { personality: '', replyStyle: '', behaviorStyle: '' },
  astrbot: { systemPrompt: '', dialoguePairs: [] },
});

const subscribeToHydration = () => () => {};
export function CreatePersonaForm() {
  // Header 会先填充同一个 Query 缓存，表单需等当前边界完成 hydration 后再读取它
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  if (!hydrated)
    return (
      <div className="flex flex-col gap-6" role="status" aria-label="正在准备创作表单">
        <PageIntro title="创建人设" description="写下角色的故事" />
        <Skeleton className="h-80 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  return <CreationSession />;
}
function CreationSession() {
  const auth = useQuery(authQuery);
  const accountId = auth.data?.data.account?.id;
  const [identity, setIdentity] = useState<{ owner?: string; epoch: number }>({ epoch: 0 });
  if (accountId && identity.owner !== accountId)
    setIdentity({ owner: accountId, epoch: identity.epoch + (identity.owner ? 1 : 0) });
  return <CreatePersonaFields key={identity.epoch} auth={auth} />;
}
function CreatePersonaFields({ auth }: { auth: UseQueryResult<AuthContextResponse> }) {
  const router = useRouter();
  const client = useQueryClient();
  const drafts = useCreationDrafts();
  const taxonomy = useQuery({ queryKey: ['site', 'taxonomy'], queryFn: personasApi.taxonomy });
  const form = useForm<PersonaDraft>({
    resolver: zodResolver(PersonaDraftSchema),
    defaultValues: emptyPersonaDraft('maibot'),
  });
  const platform = useWatch({ control: form.control, name: 'platform' });
  const buffers = useRef(emptyBuffers());
  const account = auth.data?.data.account;
  useEffect(() => {
    if (auth.isPending || auth.isError) return;
    const saved = drafts.take(account ? { id: account.id, role: account.role } : null);
    if (!saved) return;
    buffers.current = saved.buffers;
    form.reset(saved.draft, { keepDefaultValues: true });
  }, [auth.isPending, auth.isError, account, drafts, form]);
  const active = useRef(true);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const [previewOpen, setPreviewOpen] = useState(false);
  const errorTarget = useRef<HTMLDivElement>(null);
  const mutation = useMutation({
    mutationFn: async ({ draft, intent }: { draft: PersonaDraft; intent: 'edit' | 'release' }) => ({
      result: await personasApi.createComplete(draft),
      intent,
    }),
    onSuccess: ({ result, intent }) => {
      if (!active.current) return;
      const currentActor = client.getQueryData<AuthContextResponse>(authQuery.queryKey)?.data
        .account;
      if (auth.data?.data.account && currentActor?.id !== auth.data.data.account.id) return;
      drafts.clear();
      void client.invalidateQueries({ queryKey: ['private', 'personas'] });
      router.push(
        '/dashboard/personas/' +
          result.data.id +
          '/edit' +
          (intent === 'release' ? '?createRelease=1' : ''),
      );
    },
    retry: false,
    gcTime: 0,
  });
  useUnsavedDraft(form.formState.isDirty && !mutation.isSuccess, undefined, retainsCreationDraft);
  const error = mutation.error ?? form.formState.errors.root?.['publication']?.message;
  useEffect(() => {
    if (error) errorTarget.current?.focus();
  }, [error]);
  const limits = taxonomy.data?.data.contentLimits ?? defaultContentLimits;
  const choosePlatform = (next: Platform) => {
    const current = form.getValues();
    if (next === current.platform) return;
    if (current.platform === 'maibot') buffers.current.maibot = structuredClone(current.content);
    else buffers.current.astrbot = structuredClone(current.content);
    const draft: PersonaDraft =
      next === 'maibot'
        ? { ...current, platform: 'maibot', content: structuredClone(buffers.current.maibot) }
        : { ...current, platform: 'astrbot', content: structuredClone(buffers.current.astrbot) };
    form.reset(draft, { keepDefaultValues: true });
  };
  const avatarPending = useIsMutating({ mutationKey: personaAvatarUploadKey }) > 0;
  const save = form.handleSubmit((draft) => {
    if (!avatarPending) mutation.mutate({ draft, intent: 'edit' });
  });
  const release = form.handleSubmit((draft) => {
    if (avatarPending) return;
    const checked = createPublicSnapshotSchema(limits).safeParse(publicSnapshotCandidate(draft));
    if (!checked.success || !draft.rightsAccepted) {
      form.setError('root.publication', {
        message: '请先完善内容检查中的必填项，也可以先创建私有草稿',
      });
      return;
    }
    mutation.mutate({ draft, intent: 'release' });
  });
  const pending = mutation.isPending;
  const actions = (
    <>
      <Button
        type="submit"
        disabled={pending || avatarPending}
        className="h-auto min-h-11 min-w-0 flex-1 whitespace-normal"
        variant="outline"
      >
        {pending ? (
          <LoaderCircleIcon className="motion-safe:animate-spin" aria-hidden />
        ) : (
          <SaveIcon aria-hidden />
        )}
        创建私有草稿
      </Button>
      <Button
        type="button"
        disabled={pending || avatarPending || !taxonomy.data}
        className="h-auto min-h-11 min-w-0 flex-1 whitespace-normal"
        onClick={() => void release()}
      >
        <SendIcon aria-hidden />
        创建版本
      </Button>
    </>
  );
  return (
    <FormProvider {...form}>
      <form
        id="create-persona-form"
        noValidate
        onSubmit={save}
        className="grid min-w-0 items-start gap-6 @min-[72rem]/creation:grid-cols-[minmax(0,1fr)_20rem]"
      >
        <div className="flex min-w-0 flex-col gap-5">
          <header className="pb-1">
            <PageIntro
              className="flex-row items-start"
              title="创建人设"
              description="写下角色的故事"
              actions={
                <Link
                  href="/dashboard/personas"
                  aria-label="返回我的人设"
                  className={buttonVariants({ variant: 'ghost', className: 'min-w-11' })}
                >
                  <ArrowLeftIcon aria-hidden />
                  <span className="hidden sm:inline">返回</span>
                </Link>
              }
            />
          </header>
          <div className="sticky top-16 z-20 -mx-4 flex flex-col gap-3 border-y bg-background/95 px-4 py-3 backdrop-blur-sm sm:mx-0 sm:rounded-xl sm:border @min-[72rem]/creation:hidden">
            <div className="flex items-center justify-between gap-3">
              <span role="status" className="text-sm text-muted-foreground">
                {pending ? '正在保存…' : '尚未保存到服务器'}
              </span>
              <Button type="button" size="sm" variant="ghost" onClick={() => setPreviewOpen(true)}>
                <EyeIcon aria-hidden />
                预览
              </Button>
            </div>
            <div className="@container/creation-actions">
              <div className="flex flex-col gap-2 @min-[20rem]/creation-actions:flex-row">
                {actions}
              </div>
            </div>
          </div>
          {!auth.isPending && (auth.isError || auth.data.data.assurance !== 'authenticated') ? (
            <Alert>
              <LockKeyholeIcon aria-hidden />
              <AlertDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>{account ? '验证身份后保存草稿' : '登录后保存草稿'}</span>
                <Link
                  href={
                    (account ? '/mfa' : '/login') + '?returnTo=' + encodeURIComponent(creationPath)
                  }
                  onClick={() => {
                    const draft = form.getValues();
                    const retained = structuredClone(buffers.current);
                    if (draft.platform === 'maibot') retained.maibot = draft.content;
                    else retained.astrbot = draft.content;
                    drafts.write(
                      account ? { id: account.id, role: account.role } : null,
                      draft,
                      retained,
                    );
                  }}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center font-medium text-primary underline underline-offset-4"
                >
                  {account ? '去验证' : '去登录'}
                </Link>
              </AlertDescription>
            </Alert>
          ) : null}
          {error && (
            <div
              ref={errorTarget}
              tabIndex={-1}
              className="scroll-mt-48 focus-visible:outline-2 focus-visible:outline-ring"
            >
              <FormNotice error={error} />
            </div>
          )}
          <fieldset disabled={pending} className="min-w-0">
            <legend className="sr-only">人设创作资料</legend>
            <div className="flex min-w-0 flex-col gap-5">
              <EditorSection
                id="basic-information"
                step="01"
                title="基本信息"
                description="让大家第一眼认识你的角色，未填完也可以先存草稿"
              >
                <div className="grid min-w-0 items-start gap-5 sm:grid-cols-2">
                  <DraftText name="title" label="人设名称" limit={80} />
                  <CategoryField />
                  <DraftText name="summary" label="一句话简介" limit={200} />
                  <PersonaAvatarField />
                  <div className="min-w-0 sm:col-span-2">
                    <TagsField />
                  </div>
                </div>
              </EditorSection>
              <PlatformField value={platform} onChange={choosePlatform} />
              {taxonomy.isPending ? (
                <Skeleton className="h-80 w-full" aria-label="正在读取正文规则" />
              ) : taxonomy.isError ? (
                <EditorSection
                  title="暂时无法读取正文规则"
                  description="已有输入仍保留，请重试后继续填写"
                >
                  <Button type="button" variant="outline" onClick={() => void taxonomy.refetch()}>
                    重试读取正文规则
                  </Button>
                </EditorSection>
              ) : platform === 'maibot' ? (
                <MaiBotFields limits={limits} step="03" />
              ) : (
                <AstrBotFields limits={limits} step="03" />
              )}
              <RecommendedModelsFields step="04" />
              {auth.data?.data.assurance === 'authenticated' ? (
                <AssetLibrary step="05" />
              ) : (
                <EditorSection
                  id="persona-assets"
                  step="05"
                  title="素材库"
                  description="登录后可上传作品图片，授权证据仅自己和审核人员可见"
                >
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <LockKeyholeIcon className="size-4" aria-hidden />
                    当前输入可以继续保留，素材需要登录后添加
                  </p>
                </EditorSection>
              )}
              <ReadmeEditor step="06" />
              <OriginFields />
            </div>
          </fieldset>
          <p className="flex items-start gap-2 text-sm leading-6 text-muted-foreground">
            <LockKeyholeIcon className="mt-1 size-4 shrink-0 text-primary" aria-hidden />
            先保存到私有草稿，创建版本后仍需确认并提交审核，草稿不会直接公开
          </p>
        </div>
        <aside className="sticky top-28 hidden max-h-[calc(100dvh-8rem)] min-w-0 flex-col gap-4 @min-[72rem]/creation:flex">
          <div
            role="region"
            aria-label="作品预览与内容检查"
            tabIndex={0}
            className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-xl focus-visible:outline-2 focus-visible:outline-ring"
          >
            <CreatorCard />
            <DraftChecks limits={limits} />
          </div>
          <div className="flex shrink-0 flex-col gap-3 rounded-2xl border bg-card p-4 shadow-panel">
            <p role="status" className="text-sm text-muted-foreground">
              {pending ? '正在保存…' : '尚未保存到服务器'}
            </p>
            <div className="grid gap-2">{actions}</div>
            <p className="text-xs leading-5 text-muted-foreground">
              保存后可继续自动保存与管理版本
            </p>
          </div>
        </aside>
      </form>
      <CreatorPreviewSheet open={previewOpen} onOpenChange={setPreviewOpen} limits={limits} />
    </FormProvider>
  );
}
