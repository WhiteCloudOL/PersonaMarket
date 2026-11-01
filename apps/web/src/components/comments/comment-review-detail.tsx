'use client';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ReviewCommentSchema, type AdminCommentSchema } from '@personamarket/contracts';
import type { z } from 'zod';
import { Button } from '@personamarket/ui/components/button';
import { Badge } from '@personamarket/ui/components/badge';
import { Checkbox } from '@personamarket/ui/components/checkbox';
import { Textarea } from '@personamarket/ui/components/textarea';
import { Field, FieldGroup, FieldLabel, FieldError } from '@personamarket/ui/components/field';
import { ToggleGroup, ToggleGroupItem } from '@personamarket/ui/components/toggle-group';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@personamarket/ui/components/sheet';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { commentsApi, moderationCommentsKey } from '@/lib/comments-api';
import { FormNotice, SubmitButton } from '../auth/auth-fields';
import { useUnsavedDraft } from '../personas/use-unsaved-draft';
import { commentStatusLabels } from './comment-manage';

type Snapshot = z.infer<typeof AdminCommentSchema>;
const actions = {
  approve: '通过',
  reject: '驳回',
  auto_approve: '按策略自动批准',
  hide: '隐藏',
  restore: '恢复',
  delete: '作者删除',
} as const;
function ReviewFields({
  initial,
  accountId,
  role,
  reload,
  changed,
  onDirty,
  onBusy,
}: {
  initial: Snapshot;
  accountId: string;
  role: string;
  reload: () => Promise<Snapshot | undefined>;
  changed: () => Promise<void>;
  onDirty: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [notice, setNotice] = useState<string>();
  const [loading, setLoading] = useState(false);
  const form = useForm<
    z.input<typeof ReviewCommentSchema>,
    unknown,
    z.output<typeof ReviewCommentSchema>
  >({
    resolver: zodResolver(ReviewCommentSchema),
    defaultValues: {
      revisionId: initial.latest.id,
      expectedRevision: initial.revision,
      decision: 'approve',
      reason: '',
      selfReviewConfirmed: false,
    },
  });
  const decision = useWatch({ control: form.control, name: 'decision' });
  const request = useRef<{ signature: string; key: string } | null>(null);
  function key(value: unknown) {
    const signature = JSON.stringify(value);
    if (!request.current || request.current.signature !== signature)
      request.current = { signature, key: crypto.randomUUID() };
    return request.current.key;
  }
  const review = useMutation({
    mutationFn: (body: z.infer<typeof ReviewCommentSchema>) =>
      commentsApi.review(accountId, snapshot.id, body, key({ action: 'review', ...body })),
    retry: false,
    onSuccess: async (result) => {
      setSnapshot(result.data);
      form.reset({
        revisionId: result.data.latest.id,
        expectedRevision: result.data.revision,
        decision: 'approve',
        reason: '',
        selfReviewConfirmed: false,
      });
      setNotice('审核决定已保存');
      await changed();
    },
  });
  const visibility = useMutation({
    mutationFn: (value: z.infer<typeof ReviewCommentSchema>) => {
      const body = {
        hidden: snapshot.visibility !== 'hidden',
        expectedRevision: snapshot.revision,
        reason: value.reason,
        selfReviewConfirmed: value.selfReviewConfirmed,
      };
      return commentsApi.visibility(
        accountId,
        snapshot.id,
        body,
        key({ action: 'visibility', ...body }),
      );
    },
    retry: false,
    onSuccess: async (result) => {
      setSnapshot(result.data);
      form.reset({
        revisionId: result.data.latest.id,
        expectedRevision: result.data.revision,
        decision: 'approve',
        reason: '',
        selfReviewConfirmed: false,
      });
      setNotice(result.data.visibility === 'hidden' ? '评论已隐藏' : '评论已恢复');
      await changed();
    },
  });
  const busy = review.isPending || visibility.isPending;
  const error = review.error ?? visibility.error;
  useUnsavedDraft(form.formState.isDirty, '评论审核还有未提交的理由，确定离开吗');
  useEffect(() => {
    onDirty(form.formState.isDirty);
  }, [form.formState.isDirty, onDirty]);
  useEffect(() => {
    onBusy(busy);
  }, [busy, onBusy]);
  const self = snapshot.author.id === accountId;
  const pending = snapshot.latest.status === 'PENDING' && snapshot.visibility === 'normal';
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{commentStatusLabels[snapshot.latest.status]}</Badge>
        <Badge variant="outline">文本 #{snapshot.latest.number}</Badge>
        <span className="break-all text-sm">@{snapshot.author.username}</span>
        {self && <Badge variant="outline">本人评论</Badge>}
      </div>
      <section className="flex min-w-0 flex-col gap-3 rounded-xl border p-4">
        <h3 className="font-medium">本次审核文本</h3>
        <p className="whitespace-pre-wrap text-base leading-7 [overflow-wrap:anywhere]">
          {snapshot.latest.body}
        </p>
      </section>
      {snapshot.published && snapshot.published.id !== snapshot.latest.id && (
        <section className="flex min-w-0 flex-col gap-3 rounded-xl border bg-muted p-4">
          <h3 className="font-medium">当前获批文本</h3>
          <p className="whitespace-pre-wrap text-base leading-7 [overflow-wrap:anywhere]">
            {snapshot.published.body}
          </p>
        </section>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={busy || loading}
        onClick={() => {
          setLoading(true);
          void reload()
            .then((latest) => {
              if (!latest) return;
              setSnapshot(latest);
              form.setValue('revisionId', latest.latest.id);
              form.setValue('expectedRevision', latest.revision);
              review.reset();
              visibility.reset();
              setNotice('已读取最新审核快照，当前理由与确认状态已保留，请重新核对后提交');
            })
            .finally(() => setLoading(false));
        }}
      >
        {loading ? '正在读取…' : '读取最新审核快照'}
      </Button>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((value) => {
          visibility.reset();
          setNotice(undefined);
          review.mutate(value);
        })}
      >
        <fieldset disabled={busy || loading} className="min-w-0 border-0 p-0">
          <FieldGroup>
            {pending && (
              <Controller
                control={form.control}
                name="decision"
                render={({ field }) => (
                  <Field>
                    <FieldLabel>审核决定</FieldLabel>
                    <ToggleGroup
                      value={[field.value]}
                      onValueChange={(values) => {
                        const value = values[0];
                        if (value === 'approve' || value === 'reject') field.onChange(value);
                      }}
                      aria-label="评论审核决定"
                      variant="outline"
                    >
                      <ToggleGroupItem value="approve">通过</ToggleGroupItem>
                      <ToggleGroupItem value="reject">驳回</ToggleGroupItem>
                    </ToggleGroup>
                  </Field>
                )}
              />
            )}
            <Field data-invalid={Boolean(form.formState.errors.reason)}>
              <FieldLabel htmlFor="comment-review-reason">审核或处置理由</FieldLabel>
              <Textarea
                id="comment-review-reason"
                rows={4}
                className="max-h-[45dvh] overflow-y-auto"
                {...form.register('reason')}
                aria-invalid={Boolean(form.formState.errors.reason)}
              />
              <FieldError errors={[form.formState.errors.reason]} />
            </Field>
            {self && (
              <Controller
                control={form.control}
                name="selfReviewConfirmed"
                render={({ field }) => (
                  <Field orientation="horizontal">
                    <FieldLabel
                      htmlFor="comment-self-review"
                      className="min-h-11 cursor-pointer items-center"
                    >
                      <Checkbox
                        id="comment-self-review"
                        checked={field.value ?? false}
                        onCheckedChange={field.onChange}
                      />
                      我确认以管理员身份处理本人评论，并已填写明确理由
                    </FieldLabel>
                  </Field>
                )}
              />
            )}
            {self && role !== 'admin' && (
              <p className="text-sm text-muted-foreground">
                审核员不能审核本人评论，请交由其他审核人员处理
              </p>
            )}
            <FormNotice error={error} message={notice} />
            <div className="flex flex-wrap gap-3">
              {pending && (
                <SubmitButton pending={busy} disabled={self && role !== 'admin'}>
                  {decision === 'approve' ? '通过评论' : '驳回评论'}
                </SubmitButton>
              )}
              {role === 'admin' && snapshot.visibility !== 'deleted' && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    void form.handleSubmit((value) => {
                      if (!value.reason.trim()) {
                        form.setError('reason', { message: '请填写处置理由' });
                        return;
                      }
                      review.reset();
                      setNotice(undefined);
                      visibility.mutate(value);
                    })();
                  }}
                >
                  {snapshot.visibility === 'hidden' ? '恢复评论' : '隐藏评论'}
                </Button>
              )}
            </div>
          </FieldGroup>
        </fieldset>
      </form>
      <section className="flex min-w-0 flex-col gap-3">
        <h3 className="font-medium">处理记录</h3>
        {snapshot.records.length === 0 && (
          <p className="text-sm text-muted-foreground">还没有处理记录</p>
        )}
        {snapshot.records.map((record) => (
          <article key={record.id} className="flex min-w-0 flex-col gap-2 rounded-xl border p-4">
            <p className="break-words text-sm">
              {actions[record.action]} · {record.actor ?? '系统'}
              {record.selfReview ? ' · 管理员自审' : ''}
            </p>
            <time dateTime={record.createdAt} className="text-sm text-muted-foreground">
              {new Date(record.createdAt).toLocaleString('zh-CN')}
            </time>
            {record.reason && (
              <p className="whitespace-pre-wrap text-sm leading-7 [overflow-wrap:anywhere]">
                {record.reason}
              </p>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}

export function CommentReviewDetail({
  id,
  accountId,
  role,
  onClose,
  changed,
}: {
  id: string;
  accountId: string;
  role: string;
  onClose: () => void;
  changed: () => Promise<void>;
}) {
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: [...moderationCommentsKey(accountId), 'detail', id],
    queryFn: ({ signal }) => commentsApi.detail(accountId, id, signal),
    retry: false,
  });
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !busy && (!dirty || window.confirm('审核理由还有未提交的修改，确定关闭吗')))
          onClose();
      }}
    >
      <SheetContent className="sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>评论审核详情</SheetTitle>
          <SheetDescription>审核决定绑定当前显示的文本快照，旧获批内容独立保留</SheetDescription>
        </SheetHeader>
        <div className="flex min-w-0 flex-col gap-5 px-4 pb-6">
          {query.isPending && <Skeleton className="h-40 w-full" />}
          <FormNotice error={query.error} />
          {query.isError && (
            <Button variant="outline" onClick={() => void query.refetch()}>
              重新读取审核详情
            </Button>
          )}
          {query.data && (
            <ReviewFields
              initial={query.data.data}
              accountId={accountId}
              role={role}
              reload={async () => {
                const result = await query.refetch();
                return result.isSuccess ? result.data.data : undefined;
              }}
              changed={changed}
              onDirty={setDirty}
              onBusy={setBusy}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
