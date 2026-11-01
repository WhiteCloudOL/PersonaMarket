import type { ReactNode } from 'react';
import type { PublicComment } from '@personamarket/contracts';
import { Badge } from '@personamarket/ui/components/badge';

const placeholders = {
  deleted: '这条评论已由作者删除',
  hidden: '这条评论已被管理员隐藏',
  unavailable: '这条评论暂不可用',
} as const;
export function PublicCommentBody({
  comment,
  actions,
}: {
  comment: PublicComment;
  actions?: ReactNode;
}) {
  return (
    <article
      id={'comment-' + comment.id}
      className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 sm:p-5"
      aria-label="评论楼层"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        {comment.status === 'published' && (
          <span className="break-all font-medium">{comment.author.username}</span>
        )}
        <time dateTime={comment.createdAt} className="text-muted-foreground">
          {new Date(comment.createdAt).toLocaleString('zh-CN', {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </time>
        {comment.release && <Badge variant="outline">针对 v{comment.release.version}</Badge>}
        {comment.status === 'published' && comment.editedAt && (
          <Badge variant="secondary">已编辑</Badge>
        )}
      </div>
      {comment.status === 'published' ? (
        <div className="flex min-w-0 flex-col gap-2">
          {comment.replyTo && (
            <p className="break-all text-sm text-muted-foreground">
              回复 @{comment.replyTo.username}
            </p>
          )}
          <p className="whitespace-pre-wrap text-base leading-7 [overflow-wrap:anywhere]">
            {comment.body}
          </p>
        </div>
      ) : (
        <p className="text-sm leading-7 text-muted-foreground">{placeholders[comment.status]}</p>
      )}
      {actions && <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
    </article>
  );
}
