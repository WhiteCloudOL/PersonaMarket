import { eq } from 'drizzle-orm';
import { users, notificationPreferences } from '@personamarket/database';
import { enqueueMail } from '@personamarket/server';
import type { Transaction } from '../auth/locked-identity.js';

/** 作品和个人资料共用审核邮件偏好；只写加密Outbox，不在业务事务内发送邮件 */
export async function notifyReviewEmail(
  tx: Transaction,
  userId: string,
  key: string,
  subject: string,
  text: string,
  sourceId?: string,
  sourceType: 'persona' | 'profile_submission' = 'persona',
) {
  const [owner] = await tx
    .select({ email: users.email, verified: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.id, userId));
  const [preferences] = await tx
    .select({ reviewEmail: notificationPreferences.reviewEmail })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));
  if (owner?.verified && preferences?.reviewEmail !== false)
    await enqueueMail(
      tx,
      key,
      { to: owner.email, subject, text },
      { purpose: 'review_notice', userId, sourceType, ...(sourceId ? { sourceId } : {}) },
    );
}
