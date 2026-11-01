'use client';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ModelSuggestionsWriteSchema,
  type ModelSuggestionsWrite,
  type ModelSuggestionsResponse,
} from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Textarea } from '@personamarket/ui/components/textarea';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
} from '@personamarket/ui/components/field';
import { Alert, AlertTitle, AlertDescription } from '@personamarket/ui/components/alert';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@personamarket/ui/components/alert-dialog';
import { Spinner } from '@personamarket/ui/components/spinner';
import { cn } from '@personamarket/ui/lib/utils';
import { authQuery } from '@/lib/auth-api';
import { modelSuggestionsApi, modelSuggestionsKey } from '@/lib/model-suggestions-api';
import { useSettingsDirty } from './settings-navigation';
import { useUnsavedDraft } from '../personas/use-unsaved-draft';
import { EditorSection } from '../personas/editor-section';
import { FormNotice } from '../auth/auth-fields';
import { ModelSuggestionsInputs } from './model-suggestions-inputs';
import { ModelSuggestionsSummary } from './model-suggestions-summary';
import { ModelSuggestionsRecords } from './model-suggestions-records';
import { announcementDate } from '../announcements/announcement-content';

type Draft = { snapshot: ModelSuggestionsResponse; values: ModelSuggestionsWrite };
function subscribeViewport(listener: () => void) {
  window.addEventListener('resize', listener);
  window.visualViewport?.addEventListener('resize', listener);
  return () => {
    window.removeEventListener('resize', listener);
    window.visualViewport?.removeEventListener('resize', listener);
  };
}
// 软键盘等场景下优先让完整输入框可见，保存操作回到文档流
const minimumStickyViewportHeight = 640;
const constrainedViewport = () =>
  (window.visualViewport?.height ?? window.innerHeight) < minimumStickyViewportHeight;
const serverViewport = () => false;
const settingsNavigationHandlesDiscard = (target: URL, current: URL) =>
  target.origin === current.origin && target.pathname.startsWith('/admin/settings/');
function Fields({ accountId, initial }: { accountId: string; initial: ModelSuggestionsResponse }) {
  const constrained = useSyncExternalStore(subscribeViewport, constrainedViewport, serverViewport);
  const client = useQueryClient(),
    router = useRouter();
  const draftKey = useMemo(() => [...modelSuggestionsKey(accountId), 'draft'], [accountId]);
  const [preserved] = useState(() => client.getQueryData<Draft>(draftKey));
  const [snapshot, setSnapshot] = useState(preserved?.snapshot ?? initial);
  const [candidate, setCandidate] = useState<ModelSuggestionsResponse>();
  const [reading, setReading] = useState(false),
    [defaultsOpen, setDefaultsOpen] = useState(false);
  const [readError, setReadError] = useState<Error>();
  const [message, setMessage] = useState<string>();
  const command = useRef<{ signature: string; key: string } | undefined>(undefined);
  const reader = useRef<AbortController | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      reader.current?.abort();
    };
  }, []);
  const form = useForm<ModelSuggestionsWrite>({
    resolver: zodResolver(ModelSuggestionsWriteSchema),
    defaultValues: preserved?.values ?? { data: snapshot.data, reason: '' },
  });
  const [data, reason] = useWatch({ control: form.control, name: ['data', 'reason'] });
  const changed = JSON.stringify(data) !== JSON.stringify(snapshot.data);
  const dirty = changed || Boolean(reason);
  useEffect(() => {
    // 草稿没有查询观察者，避免默认回收在停留期间清空输入；账号切换和主动退出仍统一清理私有缓存
    client.setQueryDefaults(draftKey, { gcTime: Infinity });
  }, [client, draftKey]);
  useEffect(() => {
    if (dirty)
      client.setQueryData(draftKey, { snapshot, values: { data, reason } } satisfies Draft);
    else client.removeQueries({ queryKey: draftKey, exact: true });
  }, [client, draftKey, snapshot, data, reason, dirty]);
  const mutation = useMutation({
    mutationFn: (input: ModelSuggestionsWrite) => {
      const signature = JSON.stringify({ input, revision: snapshot.meta.revision });
      const prepared =
        command.current?.signature === signature
          ? command.current
          : { signature, key: crypto.randomUUID() };
      command.current = prepared;
      return modelSuggestionsApi.write(accountId, input, snapshot.meta.revision, prepared.key);
    },
    retry: false,
    onSuccess: (result, input) => {
      if (!alive.current) return;
      // 幂等重放可能读到首次提交之后的新修订，不能据此覆盖仍待确认的本地输入
      if (JSON.stringify(result.data) !== JSON.stringify(input.data)) {
        setCandidate(result);
        setReadError(undefined);
        command.current = undefined;
        client.setQueryData(modelSuggestionsKey(accountId), result);
        void client.invalidateQueries({ queryKey: ['site', 'model-suggestions'] });
        void client.invalidateQueries({ queryKey: [...modelSuggestionsKey(accountId), 'records'] });
        setMessage('服务器已有后续修订，当前输入已保留，请核对最新内容后再保存');
        router.refresh();
        return;
      }
      setSnapshot(result);
      form.reset({ data: result.data, reason: '' });
      setCandidate(undefined);
      setReadError(undefined);
      command.current = undefined;
      client.removeQueries({ queryKey: draftKey, exact: true });
      client.setQueryData(modelSuggestionsKey(accountId), result);
      void client.invalidateQueries({ queryKey: ['site', 'model-suggestions'] });
      void client.invalidateQueries({ queryKey: [...modelSuggestionsKey(accountId), 'records'] });
      setMessage('模型建议已保存，创作页面重新读取时使用新列表');
      router.refresh();
    },
  });
  useSettingsDirty(dirty || mutation.isPending);
  useUnsavedDraft(
    dirty || mutation.isPending,
    '还有未保存的模型建议，确定离开吗',
    settingsNavigationHandlesDiscard,
  );
  async function readLatest() {
    setReading(true);
    setReadError(undefined);
    const controller = new AbortController();
    reader.current = controller;
    try {
      const result = await modelSuggestionsApi.read(accountId, controller.signal);
      if (alive.current) setCandidate(result);
    } catch (cause) {
      if (alive.current)
        setReadError(cause instanceof Error ? cause : new Error('最新模型建议暂时无法读取'));
    } finally {
      if (alive.current) setReading(false);
    }
  }
  const busy = mutation.isPending || reading;
  return (
    <>
      <FormNotice message={message} />
      <p className="text-sm text-muted-foreground">
        当前核对修订 {snapshot.meta.revision} ·{' '}
        {snapshot.meta.updatedBy ? '修改人 ' + snapshot.meta.updatedBy : '暂无修改记录'} · 更新于{' '}
        {announcementDate(snapshot.meta.updatedAt)}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-11 max-w-full py-2 whitespace-normal"
          disabled={busy}
          onClick={() => setDefaultsOpen(true)}
        >
          预览默认设置
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-11 max-w-full py-2 whitespace-normal"
          disabled={busy}
          onClick={() => void readLatest()}
        >
          {reading ? '正在读取…' : '核对最新模型建议'}
        </Button>
      </div>
      <form
        noValidate
        onSubmit={form.handleSubmit((value) => {
          setMessage(undefined);
          mutation.mutate(value);
        })}
        className="flex min-w-0 flex-col gap-5"
      >
        <fieldset
          disabled={mutation.isPending}
          aria-label="模型建议表单"
          className="flex min-w-0 flex-col gap-5 border-0 p-0 [&_input]:scroll-mb-36 [&_textarea]:scroll-mb-36"
        >
          <ModelSuggestionsInputs form={form} disabled={busy} />
          <EditorSection
            title="记录修改依据"
            description="保存后留下具体差异和理由，未保存的输入在页面间暂存，刷新页面后不保留"
          >
            <Field data-invalid={Boolean(form.formState.errors.reason)}>
              <FieldLabel htmlFor="model-suggestions-reason">处理理由</FieldLabel>
              <Textarea
                id="model-suggestions-reason"
                className="max-h-[40dvh] min-h-28 overflow-y-auto"
                autoComplete="off"
                {...form.register('reason')}
                disabled={busy}
                aria-invalid={Boolean(form.formState.errors.reason)}
              />
              <FieldDescription>最多 2,000 字，保留输入的换行和空白</FieldDescription>
              <FieldError errors={[form.formState.errors.reason]} />
            </Field>
          </EditorSection>
          <FormNotice error={mutation.error ?? readError} />
          {candidate && (
            <Alert role="status">
              <AlertTitle>最新模型建议 · 修订 {candidate.meta.revision}</AlertTitle>
              <AlertDescription className="flex min-w-0 flex-col gap-4">
                <ModelSuggestionsSummary value={candidate.data} />
                <p>采用最新修订后，当前输入会保留，请逐项核对后手动保存</p>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto min-h-11 max-w-full py-2 whitespace-normal"
                  disabled={busy}
                  onClick={() => {
                    setSnapshot(candidate);
                    setCandidate(undefined);
                    command.current = undefined;
                    mutation.reset();
                  }}
                >
                  采用最新修订继续核对
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {(dirty || mutation.isPending) && (
            <div
              role="group"
              aria-label="模型建议保存操作"
              className={cn(
                'flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-panel',
                !constrained && 'sticky bottom-[max(1rem,env(safe-area-inset-bottom))]',
              )}
            >
              <p role="status" className="basis-full text-sm text-muted-foreground">
                {mutation.isPending ? '正在保存，请等待结果' : '有未保存的模型建议'}
              </p>
              <Button type="submit" disabled={busy || !changed}>
                {mutation.isPending && (
                  <Spinner
                    data-icon="inline-start"
                    aria-hidden="true"
                    className="motion-reduce:animate-none"
                  />
                )}
                {mutation.isPending ? '正在保存…' : '保存模型建议'}
              </Button>
            </div>
          )}
        </fieldset>
      </form>
      <AlertDialog open={defaultsOpen} onOpenChange={setDefaultsOpen}>
        <AlertDialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <AlertDialogHeader className="shrink-0">
            <AlertDialogTitle>核对模型建议默认设置</AlertDialogTitle>
            <AlertDialogDescription>
              确认后只填入表单，填写理由并保存后才公开生效
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div
            role="region"
            aria-label="模型建议默认设置对照"
            tabIndex={0}
            className="grid min-h-0 gap-5 overflow-y-auto overscroll-contain rounded-lg focus-visible:outline-2 focus-visible:outline-ring sm:grid-cols-2"
          >
            <section className="flex min-w-0 flex-col gap-3">
              <h3 className="font-semibold">当前输入</h3>
              <ModelSuggestionsSummary value={data} />
            </section>
            <section className="flex min-w-0 flex-col gap-3">
              <h3 className="font-semibold">默认设置</h3>
              <ModelSuggestionsSummary value={snapshot.defaults} />
            </section>
          </div>
          <AlertDialogFooter className="shrink-0">
            <AlertDialogCancel>保留当前输入</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                form.reset({
                  data: structuredClone(snapshot.defaults),
                  reason: form.getValues('reason'),
                });
                setMessage(undefined);
                setDefaultsOpen(false);
              }}
            >
              填入默认值
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
export function ModelSuggestionsForm() {
  const auth = useQuery(authQuery);
  const account = auth.data?.data.account;
  const authorized = Boolean(
    account?.role === 'admin' && auth.data?.data.assurance === 'authenticated',
  );
  const accountId = authorized && account ? account.id : '';
  const query = useQuery({
    queryKey: modelSuggestionsKey(accountId),
    queryFn: ({ signal }) => modelSuggestionsApi.read(accountId, signal),
    enabled: authorized,
    retry: false,
  });
  if (!authorized) return <FormNotice error="请使用有效管理员会话维护模型建议" />;
  if (!query.data)
    return query.isPending ? (
      <div role="status">
        <span className="sr-only">正在读取模型建议…</span>
        <Skeleton className="h-64 w-full" aria-hidden="true" />
      </div>
    ) : (
      <div className="flex flex-col items-start gap-3">
        <FormNotice error={query.error} />
        <Button onClick={() => void query.refetch()}>重新读取模型建议</Button>
      </div>
    );
  return (
    <>
      {query.isError && <FormNotice error={query.error} />}
      <Fields key={accountId} accountId={accountId} initial={query.data} />
      <ModelSuggestionsRecords accountId={accountId} />
    </>
  );
}
