import { eq, sql } from 'drizzle-orm';
import { comments, commentModerationRecords } from '@personamarket/database';
import { BusinessError, enqueueNotification } from '@personamarket/server';
import type { Transaction } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';

export async function persistCommentVisibility(
  tx: Transaction,
  actor: Pick<Identity, 'account'>,
  row: typeof comments.$inferSelect,
  input: { hidden: boolean; expectedRevision: number; reason: string },
  requestId: string,
  selfReview = false,
) {
  if (row.visibility === 'deleted')
    throw new BusinessError('CONFLICT', '作者已删除的评论不能恢复或隐藏');
  if (row.revision !== input.expectedRevision)
    throw new BusinessError('REVISION_CONFLICT', '评论已更新，请刷新后重新确认');
  const visibility = input.hidden ? 'hidden' : 'normal';
  if (row.visibility === visibility) return null;
  await tx
    .update(comments)
    .set({ visibility, revision: sql`${comments.revision}+1`, updatedAt: sql`clock_timestamp()` })
    .where(eq(comments.id, row.id));
  const [record] = await tx
    .insert(commentModerationRecords)
    .values({
      commentId: row.id,
      actorId: actor.account.id,
      action: input.hidden ? 'hide' : 'restore',
      reason: input.reason,
      selfReview,
      requestId,
    })
    .returning({ id: commentModerationRecords.id });
  if (!record) throw new Error('COMMENT_MODERATION_RECORD_FAILED');
  await enqueueNotification(tx, {
    recipientId: row.authorId,
    actorId: actor.account.id,
    sourceId: record.id,
    kind: 'comment_state',
    title: input.hidden ? '评论已被管理隐藏' : '评论管理限制已解除',
    message: '你的评论展示状态有更新，可以查看自己的评论和处理说明',
    target: { type: 'own_comment', personaId: row.personaId, commentId: row.id },
  });
  return {
    recordId: record.id,
    resourceId: row.id,
    beforeRevision: row.revision,
    afterRevision: row.revision + 1,
  };
}
