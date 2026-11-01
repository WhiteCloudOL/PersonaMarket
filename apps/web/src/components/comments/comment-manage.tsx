'use client';
import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { OwnCommentSchema } from '@personamarket/contracts';
import type { z } from 'zod';
import { Button } from '@personamarket/ui/components/button';
import { Badge } from '@personamarket/ui/components/badge';
import { Skeleton } from '@personamarket/ui/components/skeleton';
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
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogCancel,
  AlertDialogAction,
} from '@personamarket/ui/components/alert-dialog';
import { ApiError } from '@/lib/auth-api';
import { commentsApi, ownCommentsKey } from '@/lib/comments-api';
import { FormNotice } from '../auth/auth-fields';
import { CommentBodyForm } from './comment-body-form';

export const commentStatusLabels = {
  PENDING: '审核中',
  APPROVED: '已通过审核',
  REJECTED: '已驳回',
  SUPERSEDED: '已替换',
} as const;
export function CommentManage({
  id,
  accountId,
  personaId,
  maxLength,
  enabled,
  onClose,
  onChanged,
}: {
  id: string;
  accountId: string;
  personaId: string;
  maxLength: number;
  enabled: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [deleting, setDeleting] = useState(false);
  const [snapshot, setSnapshot] = useState<z.infer<typeof OwnCommentSchema>>();
  const [latestRead, setLatestRead] = useState(false);
  const deletion = useRef<{ revision: number; key: string } | null>(null);
  const query = useQuery({
    queryKey: [...ownCommentsKey(accountId, personaId), 'detail', id],
    queryFn: ({ signal }) => commentsApi.ownDetail(accountId, id, signal),
    retry: false,
  });
  // 编辑依据固定到首次读取；重连等缓存刷新不能替用户推进乐观锁版本
  if (!snapshot && query.data) setSnapshot(query.data.data);
  const row = snapshot;
  async function readLatest() {
    const result = await query.refetch();
    if (result.isSuccess) {
      setSnapshot(result.data.data);
      setLatestRead(true);
    }
  }
  const remove = useMutation({
    mutationFn: async () => {
      if (!row) throw new Error('请先读取评论状态');
      if (!deletion.current || deletion.current.revision !== row.revision)
        deletion.current = { revision: row.revision, key: crypto.randomUUID() };
      return commentsApi.delete(accountId, id, row.revision, deletion.current.key);
    },
    onSuccess: async () => {
      await onChanged();
      setDeleting(false);
      onClose();
    },
    retry: false,
  });
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (open || busy || remove.isPending) return;
        if (!dirty || window.confirm('评论还有未提交的修改，确定关闭吗')) onClose();
      }}
    >
      <SheetContent className="sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>管理我的评论</SheetTitle>
          <SheetDescription>编辑后按当前策略重新审核，公开文本仅在审核通过后替换</SheetDescription>
        </SheetHeader>
        <div className="flex min-w-0 flex-col gap-5 px-4 pb-6">
          {query.isPending && <Skeleton className="h-40 w-full" />}
          <FormNotice error={query.error} />
          {query.isError && (
            <Button variant="outline" onClick={() => void query.refetch()}>
              重新读取评论
            </Button>
          )}
          {row && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{commentStatusLabels[row.latest.status]}</Badge>
                <Badge variant="outline">
                  {row.visibility === 'normal'
                    ? '正常'
                    : row.visibility === 'hidden'
                      ? '管理员已隐藏'
                      : '作者已删除'}
                </Badge>
              </div>
              {row.latest.reason && (
                <p className="whitespace-pre-wrap rounded-xl border bg-muted p-4 text-sm leading-7 [overflow-wrap:anywhere]">
                  审核说明：{row.latest.reason}
                </p>
              )}
              {row.published && row.published.id !== row.latest.id && (
                <div className="flex flex-col gap-2 rounded-xl border p-4">
                  <h3 className="font-medium">当前公开文本</h3>
                  <p className="whitespace-pre-wrap text-sm leading-7 [overflow-wrap:anywhere]">
                    {row.published.body}
                  </p>
                </div>
              )}
              {latestRead && (
                <section className="flex min-w-0 flex-col gap-2 rounded-xl border p-4">
                  <h3 className="font-medium">读取到的最新文本</h3>
                  <p className="whitespace-pre-wrap text-sm leading-7 [overflow-wrap:anywhere]">
                    {row.latest.body}
                  </p>
                </section>
              )}
              {
                <CommentBodyForm
                  initialBody={row.latest.body}
                  maxLength={maxLength}
                  label="修改评论"
                  submitLabel="提交修改"
                  requestScope={id + ':' + row.revision}
                  disabled={!enabled || row.visibility !== 'normal'}
                  onDirtyChange={setDirty}
                  onBusyChange={setBusy}
                  onSubmit={async (body, key) => {
                    setError(undefined);
                    try {
                      const result = await commentsApi.edit(
                        accountId,
                        id,
                        { body, expectedRevision: row.revision },
                        key,
                      );
                      await onChanged();
                      setDirty(false);
                      onClose();
                      return {
                        body: result.data.latest.body,
                        message:
                          result.data.latest.status === 'APPROVED'
                            ? '评论已公开'
                            : result.data.latest.status === 'PENDING'
                              ? '修改已提交，等待审核'
                              : '评论状态已同步',
                      };
                    } catch (cause) {
                      setError(cause);
                      throw cause;
                    }
                  }}
                />
              }
              {error instanceof ApiError && error.code === 'REVISION_CONFLICT' && (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-muted-foreground">
                    当前输入已保留，读取最新评论后核对并重新提交
                  </p>
                  <Button
                    variant="outline"
                    disabled={query.isFetching}
                    onClick={() => void readLatest()}
                  >
                    读取最新评论
                  </Button>
                </div>
              )}
              {row.visibility !== 'normal' && (
                <p className="text-sm leading-7 text-muted-foreground">
                  评论当前不可提交，当前输入与已有审核状态会保留
                </p>
              )}
              {row.visibility === 'hidden' && (
                <p className="whitespace-pre-wrap text-sm leading-7 [overflow-wrap:anywhere]">
                  {row.latest.body}
                </p>
              )}
              {!enabled && (
                <p className="text-sm leading-7 text-muted-foreground">
                  站点已暂停新建和编辑评论，当前输入会保留
                </p>
              )}
              {row.visibility !== 'deleted' && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    remove.reset();
                    setDeleting(true);
                  }}
                >
                  删除这条评论
                </Button>
              )}
            </>
          )}
        </div>
        <AlertDialog
          open={deleting}
          onOpenChange={(open) => {
            if (!remove.isPending) setDeleting(open);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除这条评论</AlertDialogTitle>
              <AlertDialogDescription>
                删除后保留楼层占位，正文不再公开，已有回复会保留
              </AlertDialogDescription>
            </AlertDialogHeader>
            <FormNotice error={remove.error} />
            {remove.error instanceof ApiError && remove.error.code === 'REVISION_CONFLICT' && (
              <Button variant="outline" onClick={() => void readLatest()}>
                读取最新评论
              </Button>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={remove.isPending}>保留评论</AlertDialogCancel>
              <AlertDialogAction
                disabled={remove.isPending || query.isFetching}
                onClick={() => remove.mutate()}
              >
                {remove.isPending ? '正在删除…' : '确认删除'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
