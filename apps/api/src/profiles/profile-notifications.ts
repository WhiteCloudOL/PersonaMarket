import type { ServerEnvironment } from '@personamarket/server';
import type { Transaction } from '../auth/locked-identity.js';
import { notifyReviewEmail } from '../notifications/review-email.js';

export async function notifyProfileEmail(
  tx: Transaction,
  userId: string,
  environment: Pick<ServerEnvironment, 'APP_ENCRYPTION_KEY' | 'PUBLIC_ORIGIN'>,
  action: 'submit' | 'approve' | 'reject',
  reason = '',
  sourceId?: string,
) {
  const subject =
    action === 'submit'
      ? '个人资料已提交审核'
      : action === 'approve'
        ? '个人资料审核通过'
        : '个人资料需要调整';
  const message =
    action === 'submit'
      ? '你提交的个人资料已进入审核队列，公众继续看到此前获批的资料或安全默认值'
      : action === 'approve'
        ? '个人资料已通过审核，可在资料页查看当前公开状态'
        : '本次资料审核未通过，之前获批的资料保持原样';
  await notifyReviewEmail(
    tx,
    userId,
    environment.APP_ENCRYPTION_KEY,
    subject,
    subject +
      '\n\n' +
      message +
      (reason ? '\n\n处理说明：' + reason : '') +
      '\n\n' +
      environment.PUBLIC_ORIGIN +
      '/dashboard/profile',
    sourceId,
    'profile_submission',
  );
}
