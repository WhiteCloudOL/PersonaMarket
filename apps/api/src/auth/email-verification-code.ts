import { createHmac, randomInt } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { emailVerificationCodes } from '@personamarket/database';
import { BusinessError, enqueueMail } from '@personamarket/server';
import type { Transaction } from './locked-identity.js';

type CodeTarget = { email: string } & (
  { purpose: 'registration' } | { purpose: 'email_change'; userId: string; securityVersion: number }
);

function digest(key: string, fields: (string | number)[]) {
  return createHmac('sha256', key).update(JSON.stringify(fields)).digest('hex');
}

function scope(key: string, target: CodeTarget) {
  return digest(key, [
    'email-code-scope-v1',
    target.purpose,
    target.purpose === 'registration' ? target.email : target.userId,
  ]);
}

function proof(key: string, target: CodeTarget, eventId: string, code: string) {
  return digest(key, [
    'email-code-proof-v1',
    eventId,
    target.email,
    target.purpose === 'registration' ? 0 : target.securityVersion,
    code,
  ]);
}

export async function issueEmailCode(transaction: Transaction, key: string, target: CodeTarget) {
  await transaction.execute(sql`
    DELETE FROM email_verification_codes WHERE scope_hash IN (
      SELECT scope_hash FROM email_verification_codes
      WHERE expires_at <= clock_timestamp()
      ORDER BY expires_at LIMIT 32 FOR UPDATE SKIP LOCKED
    )
  `);
  const code = String(randomInt(1000000)).padStart(6, '0');
  const label = target.purpose === 'registration' ? '注册' : '换绑邮箱';
  const eventId = await enqueueMail(transaction, key, {
    to: target.email,
    subject: `清蒸云鸭${label}验证码`,
    text: `你的${label}验证码是 ${code}\n\n请在 10 分钟内输入验证码。如果这不是你的操作，请忽略这封邮件`,
    verificationCode: true,
  });
  const expiresAt = sql`clock_timestamp() + interval '10 minutes'`;
  const codeHash = proof(key, target, eventId, code);
  await transaction
    .insert(emailVerificationCodes)
    .values({ scopeHash: scope(key, target), codeHash, eventId, expiresAt })
    .onConflictDoUpdate({
      target: emailVerificationCodes.scopeHash,
      set: { codeHash, eventId, expiresAt },
    });
}

export async function consumeEmailCode(
  transaction: Transaction,
  key: string,
  target: CodeTarget,
  code: string,
) {
  const scopeHash = scope(key, target);
  const [issued] = await transaction
    .select({ eventId: emailVerificationCodes.eventId })
    .from(emailVerificationCodes)
    .where(eq(emailVerificationCodes.scopeHash, scopeHash));
  const used = issued
    ? await transaction
        .delete(emailVerificationCodes)
        .where(
          and(
            eq(emailVerificationCodes.scopeHash, scopeHash),
            eq(emailVerificationCodes.eventId, issued.eventId),
            eq(emailVerificationCodes.codeHash, proof(key, target, issued.eventId, code)),
            sql`${emailVerificationCodes.expiresAt} > clock_timestamp()`,
          ),
        )
        .returning({ eventId: emailVerificationCodes.eventId })
    : [];
  if (!used.length)
    throw new BusinessError('INVALID_INPUT', '验证码不正确或已过期，请核对或重新发送');
}
