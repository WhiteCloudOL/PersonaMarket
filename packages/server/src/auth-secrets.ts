import { createHash, randomBytes } from 'node:crypto';
import { OpaqueAuthTokenSchema, type AuthTokenPurpose } from '@personamarket/contracts';

type SecretPurpose = AuthTokenPurpose | 'session' | 'csrf' | 'mfa_recovery';

/** 只用于高熵随机令牌，绝不可用于密码哈希。 */
export function hashAuthSecret(purpose: SecretPurpose, token: string): string | undefined {
  if (!OpaqueAuthTokenSchema.safeParse(token).success) return undefined;
  return createHash('sha256').update(`personamarket:${purpose}\0`).update(token).digest('hex');
}

export function issueAuthSecret(purpose: SecretPurpose): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  const hash = hashAuthSecret(purpose, token);
  if (!hash) throw new Error('Random token encoding invariant failed');
  return { token, hash };
}
