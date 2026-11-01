'use client';
import { useQuery } from '@tanstack/react-query';
import type { PublicComment } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { commentsApi, commentsKey } from '@/lib/comments-api';
import { FormNotice } from '../auth/auth-fields';
import { PublicCommentBody } from './public-comment';
import { CommentPagination } from './comment-pagination';
import { ReportButton } from '../reports/report-button';

type PublishedComment = Extract<PublicComment, { status: 'published' }>;
export function CommentThread({
  root,
  personaId,
  accountId,
  canReply,
  opened,
  page,
  onToggle,
  onReply,
  onManage,
}: {
  root: PublicComment;
  personaId: string;
  accountId: string | undefined;
  canReply: boolean;
  opened: boolean;
  page: number;
  onToggle: () => void;
  onReply: (rootId: string, target: PublishedComment) => void;
  onManage: (id: string) => void;
}) {
  const query = useQuery({
    queryKey: [...commentsKey(personaId), 'replies', root.id, page],
    queryFn: ({ signal }) =>
      commentsApi.replies(root.id, { page, pageSize: 20, sort: 'oldest' }, signal),
    enabled: opened,
    retry: false,
  });
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <PublicCommentBody
        comment={root}
        actions={
          <>
            {root.status === 'published' && (
              <Button
                type="button"
                variant="ghost"
                disabled={!canReply}
                onClick={() => onReply(root.id, root)}
              >
                回复
              </Button>
            )}
            {root.status === 'published' && root.author.id === accountId && (
              <Button type="button" variant="ghost" onClick={() => onManage(root.id)}>
                管理这条评论
              </Button>
            )}
            {root.status === 'published' && (
              <ReportButton target={{ type: 'comment', commentId: root.id }} />
            )}
            {(root.replyCount > 0 || opened) && (
              <Button type="button" variant="outline" onClick={onToggle} aria-expanded={opened}>
                {opened ? '收起回复' : `查看 ${root.replyCount} 条回复`}
              </Button>
            )}
          </>
        }
      />
      {opened && (
        <div
          className="flex min-w-0 flex-col gap-3 border-l-2 border-border pl-3 sm:pl-5"
          aria-label="楼层回复"
        >
          {query.isPending && <Skeleton className="h-24 w-full" />}
          <FormNotice error={query.error} />
          {query.isError && (
            <Button variant="outline" onClick={() => void query.refetch()}>
              重新读取回复
            </Button>
          )}
          {query.data?.data.length === 0 && (
            <p className="py-4 text-sm text-muted-foreground">还没有公开回复</p>
          )}
          {query.data?.data.map((reply) => (
            <PublicCommentBody
              key={reply.id}
              comment={reply}
              actions={
                <>
                  {root.status === 'published' && reply.status === 'published' && (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={!canReply}
                      onClick={() => onReply(root.id, reply)}
                    >
                      回复
                    </Button>
                  )}
                  {reply.status === 'published' && reply.author.id === accountId && (
                    <Button type="button" variant="ghost" onClick={() => onManage(reply.id)}>
                      管理这条评论
                    </Button>
                  )}
                  {reply.status === 'published' && (
                    <ReportButton target={{ type: 'comment', commentId: reply.id }} />
                  )}
                </>
              }
            />
          ))}
          {query.data && (
            <CommentPagination
              page={page}
              pageSize={query.data.meta.pageSize}
              total={query.data.meta.total}
              parameter="repliesPage"
              label="楼层回复分页"
              pending={query.isFetching}
            />
          )}
        </div>
      )}
    </div>
  );
}
