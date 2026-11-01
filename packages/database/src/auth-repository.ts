import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Database } from './connection.js';
import { authSessions, authTokens, users } from './auth-schema.js';

type Transaction = Parameters<Parameters<Database['db']['transaction']>[0]>[0];
type Purpose = typeof authTokens.$inferSelect.purpose;
type TokenIdentity = Pick<typeof authTokens.$inferSelect, 'userId' | 'targetEmail'>;

/** 消耗标记和账户变更共同提交；失败回滚，过期/错用途/重放不调用业务回调。 */
export async function consumeAuthToken<T>(
  database: Database,
  purpose: Purpose,
  tokenHash: string,
  action: (transaction: Transaction, identity: TokenIdentity) => Promise<T>,
): Promise<{ consumed: true; value: T } | { consumed: false }> {
  return database.db.transaction(async (transaction) => {
    const [candidate] = await transaction
      .select({ userId: authTokens.userId })
      .from(authTokens)
      .where(and(eq(authTokens.purpose, purpose), eq(authTokens.tokenHash, tokenHash)))
      .limit(1);
    if (!candidate) return { consumed: false };
    // 与重发、登录和安全设置共用账户优先的锁顺序，避免 token → user 的逆序死锁。
    await transaction
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, candidate.userId))
      .for('update');
    const [identity] = await transaction
      .update(authTokens)
      .set({ consumedAt: sql`clock_timestamp()` })
      .where(
        and(
          eq(authTokens.purpose, purpose),
          eq(authTokens.tokenHash, tokenHash),
          isNull(authTokens.consumedAt),
          gt(authTokens.expiresAt, sql`clock_timestamp()`),
        ),
      )
      .returning({ userId: authTokens.userId, targetEmail: authTokens.targetEmail });
    if (!identity) return { consumed: false };
    return { consumed: true, value: await action(transaction, identity) };
  });
}

/** 每次请求 JOIN 账户状态与安全版本，封禁/全部退出不等待会话 TTL。 */
export async function findActiveSession(database: Database, tokenHash: string) {
  const [identity] = await database.db
    .select({
      sessionId: authSessions.id,
      userId: users.id,
      role: users.role,
      emailVerifiedAt: users.emailVerifiedAt,
      mfaVerifiedAt: authSessions.mfaVerifiedAt,
      restricted: authSessions.restricted,
    })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(
      and(
        eq(authSessions.tokenHash, tokenHash),
        eq(authSessions.securityVersion, users.securityVersion),
        eq(users.status, 'active'),
        isNull(authSessions.revokedAt),
        gt(authSessions.expiresAt, sql`clock_timestamp()`),
      ),
    )
    .limit(1);
  return identity;
}
