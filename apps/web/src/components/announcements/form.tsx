'use client';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import {
  AnnouncementWriteSchema,
  AnnouncementActionSchema,
  type AnnouncementWrite,
  type AnnouncementAction,
  type AnnouncementActionName,
  type ManagedAnnouncement,
} from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Input } from '@personamarket/ui/components/input';
import { Textarea } from '@personamarket/ui/components/textarea';
import { Checkbox } from '@personamarket/ui/components/checkbox';
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
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
import { FormNotice } from '../auth/auth-fields';
import { AnnouncementBody } from './announcement-content';
import { announcementsApi, type AnnouncementCommand } from '@/lib/announcements-api';

const labels = {
  publish: {
    title: '确认发布公告',
    description: '本次将公开已保存的标题、摘要和正文',
    button: '准备发布公告',
  },
  withdraw: {
    title: '确认撤回公告',
    description: '公开页面和首页将停止展示，编辑稿与记录会保留',
    button: '准备撤回公告',
  },
  archive: {
    title: '确认归档公告',
    description: '公告停止公开，恢复后需要重新核对发布',
    button: '准备归档公告',
  },
  restore: {
    title: '确认恢复公告',
    description: '恢复后保留编辑稿，核对后再决定是否发布',
    button: '准备恢复公告',
  },
};
const statuses = { draft: '未发布', published: '已公开', withdrawn: '已撤回', archived: '已归档' };
type StateCommand = {
  action: AnnouncementActionName;
  id: string;
  revision: number;
  body: AnnouncementAction;
};
export function AnnouncementForm({
  initial,
  accountId,
  onDirty,
  onBusy,
  saved,
}: {
  initial: ManagedAnnouncement | null;
  accountId: string;
  onDirty: (value: boolean) => void;
  onBusy: (value: boolean) => void;
  saved: () => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [candidate, setCandidate] = useState<ManagedAnnouncement>();
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<Error>();
  const [preview, setPreview] = useState(false);
  const [confirmation, setConfirmation] = useState<StateCommand>();
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
  const form = useForm<AnnouncementWrite>({
    resolver: zodResolver(AnnouncementWriteSchema),
    defaultValues: {
      title: initial?.title ?? '',
      summary: initial?.summary ?? '',
      body: initial?.body ?? '',
      pinned: initial?.pinned ?? false,
      reason: '',
    },
  });
  const [title, summary, body] = useWatch({
    control: form.control,
    name: ['title', 'summary', 'body'],
  });
  const mutation = useMutation({
    mutationFn: (input: AnnouncementCommand) => {
      const signature = JSON.stringify(input);
      const prepared =
        command.current?.signature === signature
          ? command.current
          : { signature, key: crypto.randomUUID() };
      command.current = prepared;
      return announcementsApi.write(accountId, input, prepared.key);
    },
    retry: false,
    onSuccess: async () => {
      onDirty(false);
      await saved();
    },
  });
  const dirty = form.formState.isDirty;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    onBusy(mutation.isPending);
    return () => onBusy(false);
  }, [mutation.isPending, onBusy]);
  const changed = Boolean(
    form.formState.dirtyFields.title ||
    form.formState.dirtyFields.summary ||
    form.formState.dirtyFields.body ||
    form.formState.dirtyFields.pinned,
  );
  const archived = snapshot?.status === 'archived';
  async function readLatest() {
    if (!snapshot) return;
    setReading(true);
    setReadError(undefined);
    const controller = new AbortController();
    reader.current = controller;
    try {
      const result = await announcementsApi.detail(accountId, snapshot.id, controller.signal);
      if (alive.current) setCandidate(result.data);
    } catch (cause) {
      if (alive.current)
        setReadError(cause instanceof Error ? cause : new Error('最新公告暂时无法读取'));
    } finally {
      if (alive.current) setReading(false);
    }
  }
  function prepare(action: AnnouncementActionName) {
    if (!snapshot) return;
    const reason = AnnouncementActionSchema.safeParse({
      reason: form.getValues('reason'),
      confirmed: true,
    });
    if (!reason.success) {
      form.setError('reason', { message: reason.error.issues[0]?.message ?? '请填写处理理由' });
      return;
    }
    form.clearErrors('reason');
    setConfirmation({ action, id: snapshot.id, revision: snapshot.revision, body: reason.data });
  }
  return (
    <>
      <form
        noValidate
        onSubmit={form.handleSubmit((value) =>
          mutation.mutate(
            snapshot
              ? { action: 'edit', id: snapshot.id, revision: snapshot.revision, body: value }
              : { action: 'create', body: value },
          ),
        )}
      >
        <FieldGroup>
          <Field data-invalid={Boolean(form.formState.errors.title)}>
            <FieldLabel htmlFor="announcement-title">公告标题</FieldLabel>
            <Input
              id="announcement-title"
              autoComplete="off"
              spellCheck={false}
              {...form.register('title')}
              disabled={mutation.isPending || archived}
              aria-invalid={Boolean(form.formState.errors.title)}
            />
            <FieldDescription>最多 160 字，不使用首尾空格或换行</FieldDescription>
            <FieldError errors={[form.formState.errors.title]} />
          </Field>
          <Field data-invalid={Boolean(form.formState.errors.summary)}>
            <FieldLabel htmlFor="announcement-summary">简短摘要</FieldLabel>
            <Input
              id="announcement-summary"
              autoComplete="off"
              spellCheck={false}
              {...form.register('summary')}
              disabled={mutation.isPending || archived}
              aria-invalid={Boolean(form.formState.errors.summary)}
            />
            <FieldDescription>选填，最多 300 字，用于列表和首页介绍</FieldDescription>
            <FieldError errors={[form.formState.errors.summary]} />
          </Field>
          <Field data-invalid={Boolean(form.formState.errors.body)}>
            <FieldLabel htmlFor="announcement-body">公告正文</FieldLabel>
            <Textarea
              id="announcement-body"
              className="max-h-[40dvh] min-h-40 overflow-y-auto"
              autoComplete="off"
              spellCheck={false}
              {...form.register('body')}
              disabled={mutation.isPending || archived}
              aria-invalid={Boolean(form.formState.errors.body)}
            />
            <FieldDescription>最多 20,000 字，以文字格式发布，保留正文换行</FieldDescription>
            <FieldError errors={[form.formState.errors.body]} />
          </Field>
          <Controller
            control={form.control}
            name="pinned"
            render={({ field }) => (
              <Field orientation="horizontal">
                <FieldLabel
                  htmlFor="announcement-pinned"
                  className="min-h-11 w-full gap-3 rounded-lg border border-border p-3"
                >
                  <Checkbox
                    id="announcement-pinned"
                    checked={field.value}
                    onCheckedChange={(value) => field.onChange(value === true)}
                    disabled={mutation.isPending || archived}
                  />
                  置顶公告
                </FieldLabel>
              </Field>
            )}
          />
          <Field data-invalid={Boolean(form.formState.errors.reason)}>
            <FieldLabel htmlFor="announcement-reason">处理理由</FieldLabel>
            <Textarea
              id="announcement-reason"
              className="max-h-[40dvh] min-h-28 overflow-y-auto"
              autoComplete="off"
              {...form.register('reason')}
              disabled={mutation.isPending}
              aria-invalid={Boolean(form.formState.errors.reason)}
            />
            <FieldDescription>每次操作填写具体理由，最多 2,000 字</FieldDescription>
            <FieldError errors={[form.formState.errors.reason]} />
          </Field>
          <FormNotice error={mutation.error ?? readError} />
          <div className="flex flex-wrap gap-2">
            {!archived && (
              <Button
                type="submit"
                disabled={mutation.isPending || reading || Boolean(snapshot && !changed)}
              >
                {mutation.isPending ? '正在处理…' : snapshot ? '保存编辑稿' : '创建编辑稿'}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              aria-expanded={preview}
              aria-controls="announcement-draft-preview"
              onClick={() => setPreview(!preview)}
            >
              预览编辑稿
            </Button>
            {snapshot && (
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending || reading}
                onClick={() => void readLatest()}
              >
                {reading ? '正在读取…' : '核对最新公告'}
              </Button>
            )}
          </div>
          {preview && (
            <section
              id="announcement-draft-preview"
              aria-label="编辑稿预览"
              className="flex min-w-0 flex-col gap-3 rounded-xl border border-border p-3"
            >
              <h3 className="font-semibold [overflow-wrap:anywhere]">
                {title || '填写公告标题后在这里预览'}
              </h3>
              {summary && (
                <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{summary}</p>
              )}
              <div
                role="region"
                aria-label="编辑稿正文预览"
                tabIndex={0}
                className="max-h-[40dvh] overflow-y-auto overscroll-contain rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
              >
                <AnnouncementBody body={body ?? ''} />
              </div>
            </section>
          )}
          {snapshot && (
            <>
              <p className="text-xs text-muted-foreground">本次核对修订 {snapshot.revision}</p>
              {changed && (
                <p className="text-sm text-muted-foreground">
                  先保存待修改的编辑稿，再核对发布或其他状态操作
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {(archived
                  ? (['restore'] as const)
                  : ([
                      'publish',
                      ...(snapshot.status === 'published' ? (['withdraw'] as const) : []),
                      'archive',
                    ] as const)
                ).map((action) => (
                  <Button
                    key={action}
                    type="button"
                    variant={
                      action === 'withdraw' || action === 'archive' ? 'destructive' : 'outline'
                    }
                    disabled={
                      mutation.isPending ||
                      reading ||
                      changed ||
                      (action === 'publish' &&
                        snapshot.status === 'published' &&
                        !snapshot.hasUnpublishedChanges)
                    }
                    onClick={() => prepare(action)}
                  >
                    {labels[action].button}
                  </Button>
                ))}
              </div>
            </>
          )}
          {candidate && (
            <Alert role="status">
              <AlertTitle>最新公告状态</AlertTitle>
              <AlertDescription className="flex min-w-0 flex-col items-start gap-3">
                <p className="[overflow-wrap:anywhere]">
                  {candidate.title} · {statuses[candidate.status]} · 修订 {candidate.revision} ·{' '}
                  {candidate.pinned ? '编辑稿已置顶' : '编辑稿未置顶'}
                </p>
                {candidate.summary && (
                  <p className="[overflow-wrap:anywhere]">{candidate.summary}</p>
                )}
                <div
                  role="region"
                  aria-label="最新公告正文"
                  tabIndex={0}
                  className="max-h-[30dvh] w-full overflow-y-auto overscroll-contain rounded-lg border border-border p-3 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <AnnouncementBody body={candidate.body} />
                </div>
                <p>采用新修订后，请逐项核对保留的输入</p>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto min-h-11 max-w-full py-2 whitespace-normal"
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
        </FieldGroup>
      </form>
      <AlertDialog
        open={Boolean(confirmation)}
        onOpenChange={(value) => {
          if (!value) setConfirmation(undefined);
        }}
      >
        <AlertDialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <AlertDialogHeader className="shrink-0">
            <AlertDialogTitle>
              {confirmation ? labels[confirmation.action].title : '核对公告操作'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation ? labels[confirmation.action].description : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div
            role="region"
            aria-label="公告操作预览"
            tabIndex={0}
            className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain rounded-lg [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-ring"
          >
            <h3 className="font-semibold">{snapshot?.title}</h3>
            {confirmation?.action === 'publish' && snapshot && (
              <>
                <p className="text-sm text-muted-foreground">{snapshot.summary}</p>
                <AnnouncementBody body={snapshot.body} />
              </>
            )}
            <p className="whitespace-pre-wrap text-sm">{confirmation?.body.reason}</p>
          </div>
          <AlertDialogFooter className="shrink-0">
            <AlertDialogCancel>返回核对</AlertDialogCancel>
            <AlertDialogAction
              variant={
                confirmation?.action === 'withdraw' || confirmation?.action === 'archive'
                  ? 'destructive'
                  : 'default'
              }
              onClick={() => {
                if (!confirmation) return;
                const input = confirmation;
                setConfirmation(undefined);
                mutation.mutate(input);
              }}
            >
              确认处理
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
