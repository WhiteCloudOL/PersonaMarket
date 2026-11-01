import { eq } from 'drizzle-orm';
import { comments } from '@personamarket/database';
import { enqueueNotification } from '@personamarket/server';
import type { Transaction } from '../auth/locked-identity.js';
import type { CommentRow } from './comment-helpers.js';

export async function notifyCommentReview(
  tx: Transaction,
  row: CommentRow,
  revisionId: string,
  decision: 'approve' | 'reject',
  actorId: string | null,
) {
  await enqueueNotification(tx, {
    recipientId: row.authorId,
    actorId,
    sourceId: revisionId,
    kind: decision === 'approve' ? 'comment_approved' : 'comment_rejected',
    title: decision === 'approve' ? '评论审核通过' : '评论需要修改',
    message: '你的评论已有审核结果，可以查看自己的评论和处理说明',
    target: { type: 'own_comment', personaId: row.personaId, commentId: row.id },
  });
  // 只在首次公开时提醒被回复者，编辑重审和待审文本均不触发对外提醒
  if (decision !== 'approve' || row.firstPublishedAt || !row.parentId) return;
  const [addressed] = await tx
    .select({ authorId: comments.authorId })
    .from(comments)
    .where(eq(comments.id, row.replyToId ?? row.parentId));
  if (!addressed || addressed.authorId === row.authorId) return;
  await enqueueNotification(tx, {
    recipientId: addressed.authorId,
    actorId: row.authorId,
    sourceId: row.id,
    kind: 'comment_reply',
    title: '你收到一条公开回复',
    message: '有人回复了你的评论，审核通过的回复现在可以查看',
    target: { type: 'public_comment', personaId: row.personaId, commentId: row.id },
  });
}
