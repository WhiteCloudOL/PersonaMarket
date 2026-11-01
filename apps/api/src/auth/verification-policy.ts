import { BusinessError } from '@personamarket/server';

export function requireRecentVerification(
  identity: {
    account: { role: string };
    session: { createdAt: Date; mfaVerifiedAt: Date | null };
    mfaEnrolled: boolean;
  },
  required = false,
) {
  if (!required && identity.account.role !== 'admin' && !identity.mfaEnrolled) return;
  const verifiedAt = identity.mfaEnrolled
    ? identity.session.mfaVerifiedAt
    : identity.session.createdAt;
  if (!verifiedAt || Date.now() - verifiedAt.getTime() > 600_000)
    throw new BusinessError(
      identity.mfaEnrolled ? 'MFA_REQUIRED' : 'REAUTH_REQUIRED',
      '这项高危操作需要近期验证身份',
    );
}
