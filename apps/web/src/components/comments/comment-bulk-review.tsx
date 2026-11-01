'use client';
import { useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { ReviewCommentSchema, type AdminCommentSchema } from '@personamarket/contracts';
import type { z } from 'zod';
import { Button } from '@personamarket/ui/components/button';
import { Textarea } from '@personamarket/ui/components/textarea';
import { Checkbox } from '@personamarket/ui/components/checkbox';
import { Field, FieldError, FieldGroup, FieldLabel } from '@personamarket/ui/components/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@personamarket/ui/components/select';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@personamarket/ui/components/sheet';
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
import { ApiError } from '@/lib/auth-api';
import { commentsApi } from '@/lib/comments-api';
import { FormNotice, SubmitButton } from '../auth/auth-fields';
import { useUnsavedDraft } from '../personas/use-unsaved-draft';

type Snapshot = z.infer<typeof AdminCommentSchema>;
export function CommentBulkReview({
  selected,
  accountId,
  onClose,
  changed,
}: {
  selected: [Snapshot, ...Snapshot[]];
  accountId: string;
  onClose: () => void;
  changed: () => Promise<void>;
}) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>(selected);
  const [confirming, setConfirming] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [refreshError, setRefreshError] = useState<Error>();
  const form = useForm<
    z.input<typeof ReviewCommentSchema>,
    unknown,
    z.output<typeof ReviewCommentSchema>
  >({
    resolver: zodResolver(ReviewCommentSchema),
    defaultValues: {
      revisionId: selected[0].latest.id,
      expectedRevision: selected[0].revision,
      decision: 'approve',
      reason: '',
      selfReviewConfirmed: false,
    },
  });
  const last = useRef<{ signature: string; key: string } | null>(null);
  const mutation = useMutation({
    mutationFn: async (value: z.infer<typeof ReviewCommentSchema>) => {
      const body = {
        items: snapshots.map((row) => ({
          id: row.id,
          review: { ...value, revisionId: row.latest.id, expectedRevision: row.revision },
        })),
      };
      const signature = JSON.stringify(body);
      if (!last.current || last.current.signature !== signature)
        last.current = { signature, key: crypto.randomUUID() };
      return commentsApi.bulk(accountId, body, last.current.key);
    },
    retry: false,
    onSuccess: async (result) => {
      setConfirming(false);
      const failed = new Set(result.data.filter((item) => !item.ok).map((item) => item.id));
      setSnapshots((previous) => previous.filter((row) => failed.has(row.id)));
      setNotice(`已处理 ${result.data.length - failed.size} 条，${failed.size} 条未完成`);
      if (!failed.size) form.reset();
      await changed();
    },
    onError: () => setConfirming(false),
  });
  const stepUp = useMemo(() => {
    const item = mutation.data?.data.find(
      (result) =>
        snapshots.some((row) => row.id === result.id) &&
        !result.ok &&
        ['MFA_REQUIRED', 'REAUTH_REQUIRED'].includes(result.error.code),
    );
    return item && !item.ok ? new ApiError(item.error.message, item.error.code, []) : undefined;
  }, [mutation.data, snapshots]);
  useUnsavedDraft(form.formState.isDirty, '批量审核还有未提交的理由，确定离开吗');
  const busy = mutation.isPending || refreshing;
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (
          !open &&
          !busy &&
          (!form.formState.isDirty || window.confirm('批量审核还有未提交的理由，确定关闭吗'))
        )
          onClose();
      }}
    >
      <SheetContent className="sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>批量审核评论</SheetTitle>
          <SheetDescription>逐项核对所选文本，过期或无权限的条目会单独返回失败</SheetDescription>
        </SheetHeader>
        <div className="flex min-w-0 flex-col gap-5 px-4 pb-6">
          <FormNotice error={mutation.error} message={notice} />
          <FormNotice error={stepUp} />
          {mutation.data && (
            <ul className="flex min-w-0 flex-col gap-3" aria-label="批量审核结果">
              {mutation.data.data.map((item) => (
                <li
                  key={item.id}
                  className="rounded-xl border p-4 text-sm leading-7 [overflow-wrap:anywhere]"
                >
                  {item.ok
                    ? `已处理：@${item.data.author.username} · ${item.data.latest.body}`
                    : `未完成：${item.error.message}`}
                </li>
              ))}
            </ul>
          )}
          {snapshots.map((row) => (
            <article key={row.id} className="flex min-w-0 flex-col gap-3 rounded-xl border p-4">
              <h3 className="break-all font-medium">
                @{row.author.username} · 文本 #{row.latest.number}
              </h3>
              <p className="whitespace-pre-wrap text-base leading-7 [overflow-wrap:anywhere]">
                {row.latest.body}
              </p>
            </article>
          ))}
          {snapshots.length > 0 && (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setRefreshing(true);
                  setRefreshError(undefined);
                  void Promise.allSettled(
                    snapshots.map((row) =>
                      commentsApi.detail(accountId, row.id, AbortSignal.timeout(10000)),
                    ),
                  )
                    .then((results) => {
                      const fresh: Snapshot[] = [];
                      let read = 0;
                      for (const [index, result] of results.entries()) {
                        if (result.status === 'fulfilled') {
                          read++;
                          if (
                            result.value.data.latest.status === 'PENDING' &&
                            result.value.data.visibility === 'normal'
                          )
                            fresh.push(result.value.data);
                        } else {
                          const previous = snapshots[index];
                          if (previous) fresh.push(previous);
                          setRefreshError(
                            result.reason instanceof Error
                              ? result.reason
                              : new Error('部分评论暂时无法读取'),
                          );
                        }
                      }
                      setSnapshots(fresh);
                      setNotice(
                        `已读取 ${read} 条最新快照，已处理或不可审核的条目已移出选择，当前理由已保留`,
                      );
                    })
                    .finally(() => setRefreshing(false));
                }}
              >
                读取失败条目最新快照
              </Button>
              <FormNotice error={refreshError} />
              <form
                noValidate
                onSubmit={form.handleSubmit(() => setConfirming(true))}
                className="flex flex-col gap-4"
              >
                <FieldGroup>
                  <Controller
                    control={form.control}
                    name="decision"
                    render={({ field }) => (
                      <Field>
                        <FieldLabel htmlFor="bulk-comment-decision">批量审核决定</FieldLabel>
                        <Select
                          items={[
                            { value: 'approve', label: '通过所选文本' },
                            { value: 'reject', label: '驳回所选文本' },
                          ]}
                          value={field.value}
                          onValueChange={(value) => {
                            if (value) field.onChange(value);
                          }}
                        >
                          <SelectTrigger id="bulk-comment-decision" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="approve">通过所选文本</SelectItem>
                              <SelectItem value="reject">驳回所选文本</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>
                    )}
                  />
                  <Field data-invalid={Boolean(form.formState.errors.reason)}>
                    <FieldLabel htmlFor="bulk-comment-reason">批量审核理由</FieldLabel>
                    <Textarea
                      id="bulk-comment-reason"
                      rows={4}
                      className="max-h-[45dvh] overflow-y-auto"
                      {...form.register('reason')}
                      aria-invalid={Boolean(form.formState.errors.reason)}
                    />
                    <FieldError errors={[form.formState.errors.reason]} />
                  </Field>
                  <Controller
                    control={form.control}
                    name="selfReviewConfirmed"
                    render={({ field }) => (
                      <Field orientation="horizontal">
                        <FieldLabel
                          htmlFor="bulk-comment-self"
                          className="min-h-11 cursor-pointer items-center"
                        >
                          <Checkbox
                            id="bulk-comment-self"
                            checked={field.value ?? false}
                            onCheckedChange={field.onChange}
                          />
                          涉及本人评论时，我确认以管理员身份自审并已填写明确理由
                        </FieldLabel>
                      </Field>
                    )}
                  />
                  <SubmitButton pending={busy}>核对并处理 {snapshots.length} 条评论</SubmitButton>
                </FieldGroup>
              </form>
            </>
          )}
          {snapshots.length === 0 && <Button onClick={onClose}>返回审核队列</Button>}
        </div>
        <AlertDialog
          open={confirming}
          onOpenChange={(open) => {
            if (!mutation.isPending) setConfirming(open);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认批量处理 {snapshots.length} 条评论</AlertDialogTitle>
              <AlertDialogDescription>
                只处理当前核对的文本快照，逐项显示结果，已经变化的内容不会自动批准
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={mutation.isPending}>继续核对</AlertDialogCancel>
              <AlertDialogAction
                disabled={mutation.isPending}
                onClick={() => {
                  void form.handleSubmit((value) => mutation.mutate(value))();
                }}
              >
                {mutation.isPending ? '正在处理…' : '确认批量处理'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
