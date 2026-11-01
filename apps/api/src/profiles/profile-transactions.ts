import { eq } from 'drizzle-orm';
import { profileRecords, authAuditEvents, userMfa } from '@personamarket/database';
import { BusinessError, enqueueNotification } from '@personamarket/server';
import type { lockIdentity, Transaction } from '../auth/locked-identity.js';
import { requireRecentVerification } from '../auth/verification-policy.js';

export function requireProfileModerator(role: string) {
  if (role !== 'moderator' && role !== 'admin')
    throw new BusinessError('FORBIDDEN', '此操作需要资料审核权限');
}
export async function verifyProfileSelfReview(
  tx: Transaction,
  identity: Awaited<ReturnType<typeof lockIdentity>>,
  userId: string,
  confirmed: boolean,
  reason: string,
) {
  if (identity.account.id !== userId) return false;
  if (identity.account.role !== 'admin' || !confirmed || !reason.trim())
    throw new BusinessError('FORBIDDEN', '管理员自审需要近期验证、明确确认和理由');
  const [mfa] = await tx
    .select({ confirmedAt: userMfa.confirmedAt })
    .from(userMfa)
    .where(eq(userMfa.userId, identity.account.id));
  requireRecentVerification({ ...identity, mfaEnrolled: Boolean(mfa?.confirmedAt) }, true);
  return true;
}
export async function recordProfileAction(
  tx: Transaction,
  value: Omit<typeof profileRecords.$inferInsert, 'id' | 'createdAt'>,
) {
  const [record] = await tx
    .insert(profileRecords)
    .values(value)
    .returning({ id: profileRecords.id });
  if (!record) throw new Error('PROFILE_RECORD_INSERT_FAILED');
  await tx.insert(authAuditEvents).values({
    userId: value.actorId,
    event: 'profile.' + value.action,
    requestId: value.requestId,
  });
  if (
    value.action === 'approve' ||
    value.action === 'reject' ||
    value.action === 'hide' ||
    value.action === 'restore'
  ) {
    const title =
      value.action === 'approve'
        ? '个人资料审核通过'
        : value.action === 'reject'
          ? '个人资料需要调整'
          : value.action === 'hide'
            ? '公开资料已隐藏'
            : '公开资料已恢复';
    await enqueueNotification(tx, {
      recipientId: value.userId,
      actorId: value.actorId,
      sourceId: record.id,
      kind:
        value.action === 'approve'
          ? 'profile_approved'
          : value.action === 'reject'
            ? 'profile_rejected'
            : 'profile_state',
      title,
      message: value.reason?.trim()
        ? value.reason
        : '资料已通过审核，请在个人资料中查看当前公开状态',
      target: { type: 'own_profile' },
    });
  }
  return record.id;
}
