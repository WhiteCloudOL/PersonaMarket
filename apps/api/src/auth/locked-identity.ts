import { and, eq, sql } from 'drizzle-orm';
import { authSessions, userMfa, users, type Database } from '@personamarket/database';
import { BusinessError } from '@personamarket/server';
import type { Identity } from './auth.service.js';
import { requireRecentVerification } from './verification-policy.js';
export type Transaction = Parameters<Parameters<Database['db']['transaction']>[0]>[0];

/** 所有安全写入共用 user → session → 设置/令牌的锁顺序，并在事务内复查权限。 */
export async function lockIdentity(
  transaction: Transaction,
  identity: Identity,
  admin = false,
  recentVerification = true,
) {
  const [account] = await transaction
    .select()
    .from(users)
    .where(eq(users.id, identity.account.id))
    // 保持身份修改互斥，同时允许其他事务为通知等外键取得KEY SHARE
    // FOR UPDATE会与“本人等待作品锁、审核持有作品锁后写通知”形成环
    .for('no key update');
  const [session] = await transaction
    .select()
    .from(authSessions)
    .where(
      and(
        eq(authSessions.id, identity.session.id),
        eq(authSessions.userId, identity.account.id),
        sql`${authSessions.expiresAt} > clock_timestamp()`,
      ),
    )
    .for('update');
  if (
    !account ||
    account.status !== 'active' ||
    !session ||
    session.revokedAt ||
    account.securityVersion !== identity.account.securityVersion ||
    session.securityVersion !== account.securityVersion
  )
    throw new BusinessError('UNAUTHENTICATED', '登录状态已失效，请重新登录');
  if (admin && account.role !== 'admin')
    throw new BusinessError('FORBIDDEN', '此操作需要管理员权限');
  if (recentVerification) {
    const [mfa] = await transaction.select().from(userMfa).where(eq(userMfa.userId, account.id));
    requireRecentVerification({ account, session, mfaEnrolled: Boolean(mfa?.confirmedAt) });
  }
  return { account, session };
}
