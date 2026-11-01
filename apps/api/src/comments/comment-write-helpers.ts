import { eq, sql } from 'drizzle-orm';
import {
  authAuditEvents,
  comments,
  commentRevisions,
  commentModerationRecords,
} from '@personamarket/database';
import { BusinessError } from '@personamarket/server';
import type { z } from 'zod';
import type { InteractionSettingsSchema } from '@personamarket/contracts';
import type { Transaction } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import { notifyCommentReview } from './comment-notifications.js';

export function verifiedCommenter(account: Identity['account']) {
  if (!account.emailVerifiedAt) throw new BusinessError('FORBIDDEN', '验证邮箱后才可以发表评论');
}
export async function validateCommentWrite(
  tx: Transaction,
  userId: string,
  body: string,
  configuration: z.infer<typeof InteractionSettingsSchema>,
) {
  if (!configuration.commentsEnabled)
    throw new BusinessError('FORBIDDEN', '站点暂未开放新建或编辑评论');
  if (Array.from(body).length > configuration.commentMaxLength)
    throw new BusinessError('VALIDATION_FAILED', '评论超过站点字数限制', {
      fieldErrors: [{ path: 'body', message: `评论最多 ${configuration.commentMaxLength} 字` }],
    });
  const result = await tx.execute<{ count: number; retry: number }>(sql`
    SELECT count(*)::integer AS count,
      GREATEST(1,ceil(extract(epoch FROM min(created_at)+interval '60 seconds'-clock_timestamp())))::integer AS retry
    FROM auth_audit_events WHERE user_id=${userId} AND event IN ('comment.created','comment.edited')
      AND created_at>clock_timestamp()-interval '60 seconds'
  `);
  const rate = result.rows[0];
  if (rate && rate.count >= configuration.commentsPerMinute)
    throw new BusinessError('RATE_LIMITED', '评论提交较频繁，请稍后重试', {
      retryAfterSeconds: rate.retry,
    });
}
export async function preventDuplicateComment(
  tx: Transaction,
  userId: string,
  personaId: string,
  parentId: string | null,
  body: string,
  exceptId?: string,
) {
  const result =
    await tx.execute(sql`SELECT 1 FROM comments c JOIN comment_revisions r ON r.comment_id=c.id
    WHERE c.author_id=${userId} AND c.persona_id=${personaId} AND c.parent_id IS NOT DISTINCT FROM ${parentId}::uuid
      AND c.visibility<>'deleted' AND r.body=${body} AND r.created_at>clock_timestamp()-interval '60 seconds'
      AND ${exceptId ? sql`c.id<>${exceptId}` : sql`true`} LIMIT 1`);
  if (result.rows.length) throw new BusinessError('CONFLICT', '相同评论已提交，请勿重复发送');
}
export async function auditComment(
  tx: Transaction,
  userId: string,
  requestId: string,
  event: string,
) {
  await tx.insert(authAuditEvents).values({ userId, requestId, event });
}
export async function autoApproveComment(
  tx: Transaction,
  id: string,
  revisionId: string,
  requestId: string,
) {
  const [before] = await tx.select().from(comments).where(eq(comments.id, id));
  if (!before) throw new Error('COMMENT_AUTO_APPROVE_MISSING');
  await tx
    .update(commentRevisions)
    .set({ status: 'APPROVED', reason: '' })
    .where(eq(commentRevisions.id, revisionId));
  await tx
    .update(comments)
    .set({
      publicRevisionId: revisionId,
      pendingRevisionId: null,
      firstPublishedAt: sql`COALESCE(${comments.firstPublishedAt},clock_timestamp())`,
      revision: sql`${comments.revision}+1`,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(eq(comments.id, id));
  await tx.insert(commentModerationRecords).values({
    commentId: id,
    revisionId,
    action: 'auto_approve',
    actorId: null,
    reason: '按站点关闭预审策略自动批准',
    requestId,
  });
  await notifyCommentReview(tx, before, revisionId, 'approve', null);
}
