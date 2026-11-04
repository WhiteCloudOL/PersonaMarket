'use client';
import Link from 'next/link';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import {
  PersonaDraftSchema,
  type PersonaDraft,
  type DraftResponse,
} from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Badge } from '@personamarket/ui/components/badge';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { FormNotice } from '../auth/auth-fields';
import { personasApi } from '@/lib/personas-api';
import { useDraftSave } from './use-draft-save';
import { DraftText, EditorSection, MaiBotFields, AstrBotFields } from './draft-fields';
import { ReadmeEditor } from './readme-editor';
import { MetadataFields } from './metadata-fields';
import { PersonaAvatarField } from './persona-avatar-field';
import { PersonaCoverField } from './persona-attachments';
import { ReleaseCreate } from './release-create';
import { CreatorPreview, DraftSavingHelp } from './creator-preview';
import { CreatorPreviewSheet } from './creator-preview-sheet';
import { CopyTextButton } from '../copy-text-button';
import { useState } from 'react';
import { EyeIcon, SaveIcon } from 'lucide-react';
function Editor({
  initial,
  initialAction,
}: {
  initial: DraftResponse;
  initialAction: 'release' | null;
}) {
  const form = useForm<PersonaDraft>({
    resolver: zodResolver(PersonaDraftSchema),
    defaultValues: initial.data.draft,
  });
  const save = useDraftSave(initial, form);
  const title = useWatch({ control: form.control, name: 'title' });
  const taxonomy = useQuery({ queryKey: ['site', 'taxonomy'], queryFn: personasApi.taxonomy });
  const [previewOpen, setPreviewOpen] = useState(false);
  return (
    <FormProvider {...form}>
      <div className="flex flex-col gap-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                {initial.data.draft.platform === 'maibot' ? 'MaiBot' : 'AstrBot'}
              </Badge>
              <span className="text-xs text-muted-foreground">私有草稿</span>
            </div>
            <h1 className="break-words text-2xl font-semibold">{title.trim() || '未命名人设'}</h1>
          </div>
          <nav
            aria-label="创作导航"
            className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-primary"
          >
            <Link
              href="/dashboard/personas"
              className="flex min-h-11 items-center underline underline-offset-4"
            >
              返回我的人设
            </Link>
            <Link
              href={'/dashboard/personas/' + initial.data.id + '/releases'}
              className="flex min-h-11 items-center underline underline-offset-4"
            >
              管理版本与审核状态
            </Link>
          </nav>
        </div>
        <div className="sticky top-16 z-20 -mx-4 flex flex-col gap-2 border-y bg-background/95 px-4 py-3 backdrop-blur-sm sm:mx-0 sm:rounded-xl sm:border lg:top-24 lg:flex-row lg:items-center lg:justify-between">
          <span role="status" className="text-sm text-muted-foreground">
            {
              {
                saved: '已保存到服务器',
                dirty: '有未保存的修改',
                saving: '正在保存…',
                error: '保存失败，内容仍保留在当前页面',
              }[save.state]
            }
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void save.flush().catch(() => undefined)}
            >
              <SaveIcon data-icon="inline-start" />
              保存草稿
            </Button>
            <Button
              type="button"
              variant="outline"
              className="lg:hidden"
              onClick={() => setPreviewOpen(true)}
            >
              <EyeIcon data-icon="inline-start" />
              预览
            </Button>
            <ReleaseCreate id={initial.data.id} flush={save.flush} initialAction={initialAction} />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          平台在创建后固定，自动保存不会发布作品，你可以放心继续完善
        </p>
        <FormNotice error={save.error} />
        {save.state === 'error' && (
          <div className="flex flex-wrap gap-3">
            <CopyTextButton
              label="复制本地草稿备份"
              readText={() => JSON.stringify(form.getValues(), null, 2)}
            />
            <Button
              variant="outline"
              onClick={() => {
                if (window.confirm('重新载入会丢弃当前页面未保存的修改，请先复制备份，确定继续吗'))
                  location.reload();
              }}
            >
              重新载入服务器草稿
            </Button>
            <Link
              href="/login"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm underline"
            >
              在新窗口重新登录
            </Link>
          </div>
        )}
        <form
          onSubmit={form.handleSubmit(() => void save.flush().catch(() => undefined))}
          className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]"
        >
          <div className="flex min-w-0 flex-col gap-6">
            <EditorSection
              id="basic-information"
              step="01"
              title="作品信息"
              description="让读者快速认识你的角色"
            >
              <DraftText name="title" label="人设名称" limit={80} />
              <DraftText name="summary" label="一句话简介" limit={200} />
              <div className="grid min-w-0 items-start gap-5 sm:grid-cols-2">
                <PersonaAvatarField />
                <PersonaCoverField />
              </div>
            </EditorSection>
            {taxonomy.data ? (
              initial.data.draft.platform === 'maibot' ? (
                <MaiBotFields limits={taxonomy.data.data.contentLimits} />
              ) : (
                <AstrBotFields limits={taxonomy.data.data.contentLimits} />
              )
            ) : taxonomy.isError ? (
              <FormNotice error="无法读取内容上限，请重试" />
            ) : (
              <Skeleton className="h-64 w-full" />
            )}
            <ReadmeEditor />
            <MetadataFields />
          </div>
          <aside className="hidden min-w-0 flex-col gap-5 lg:sticky lg:top-44 lg:flex lg:max-h-[calc(100dvh-12rem)] lg:self-start lg:overflow-y-auto">
            <CreatorPreview
              {...(taxonomy.data ? { limits: taxonomy.data.data.contentLimits } : {})}
            >
              <DraftSavingHelp />
            </CreatorPreview>
          </aside>
        </form>
        <CreatorPreviewSheet
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          {...(taxonomy.data ? { limits: taxonomy.data.data.contentLimits } : {})}
        >
          <DraftSavingHelp />
        </CreatorPreviewSheet>
      </div>
    </FormProvider>
  );
}
export function PersonaEditor({
  id,
  initialAction = null,
}: {
  id: string;
  initialAction?: 'release' | null;
}) {
  const query = useQuery({
    // 表单只用本次进入编辑器时读取的快照初始化，不能从版本页的旧缓存接续 revision
    queryKey: ['private', 'persona-editor', id],
    queryFn: () => personasApi.read(id),
    retry: false,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  if (query.isPending) return <Skeleton className="h-80 w-full" aria-label="正在读取草稿" />;
  if (query.isError)
    return (
      <div className="flex flex-col gap-4">
        <FormNotice error={query.error.message} />
        <Button onClick={() => void query.refetch()}>重试读取草稿</Button>
        <Link href="/login" className="underline">
          登录账号
        </Link>
      </div>
    );
  return <Editor key={id} initial={query.data} initialAction={initialAction} />;
}
