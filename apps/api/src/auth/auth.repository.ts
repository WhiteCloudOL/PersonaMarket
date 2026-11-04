import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import {
  authAuditEvents,
  authSessions,
  authTokens,
  consumeAuthToken,
  mfaRecoveryCodes,
  userMfa,
  users,
  siteSettings,
  type Database,
} from '@personamarket/database';
import {
  accountSettings,
  assertOrdinaryWriteAllowed,
  StoredMailSettingsSchema,
  environmentMail,
  BusinessError,
  enqueueMail,
  type ServerEnvironment,
} from '@personamarket/server';
import { DATABASE, ENVIRONMENT } from '../tokens.js';
import { lockIdentity } from './locked-identity.js';
import { recordSecurityEvent } from './security-notification.js';
import { consumeEmailCode, issueEmailCode } from './email-verification-code.js';

export type Account = typeof users.$inferSelect;
export type Session = typeof authSessions.$inferSelect;
type Transaction = Parameters<Parameters<Database['db']['transaction']>[0]>[0];
export type SessionIssue = {
  id: string;
  tokenHash: string;
  csrfTokenHash: string;
  deviceName: string;
};
export type MailIssue = {
  tokenHash: string;
  rawToken: string;
  purpose: 'email_verify' | 'password_reset';
  requestId: string;
};
export type RegistrationExpectation = {
  accountsRevision: number;
  mailRevision: number;
  requestId: string;
};

@Injectable()
export class AuthRepository {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENVIRONMENT) private readonly env: ServerEnvironment,
  ) {}
  async audit(event: string, requestId: string, userId?: string) {
    await this.database.db
      .insert(authAuditEvents)
      .values({ event, requestId, ...(userId ? { userId } : {}) });
  }
  async updateCsrf(sessionId: string, hash: string) {
    await this.database.db
      .update(authSessions)
      .set({ csrfTokenHash: hash })
      .where(eq(authSessions.id, sessionId));
  }
  async findAccount(identifier: string) {
    const [account] = await this.database.db
      .select()
      .from(users)
      .where(or(eq(users.username, identifier), eq(users.email, identifier)))
      .limit(1);
    return account;
  }
  async tokenAccount(purpose: 'email_verify' | 'password_reset', hash: string) {
    const [row] = await this.database.db
      .select({ username: users.username, email: users.email })
      .from(authTokens)
      .innerJoin(users, eq(authTokens.userId, users.id))
      .where(
        and(
          eq(authTokens.purpose, purpose),
          eq(authTokens.tokenHash, hash),
          isNull(authTokens.consumedAt),
          sql`${authTokens.expiresAt} > clock_timestamp()`,
          eq(users.status, 'active'),
        ),
      );
    return row;
  }
  private async queueMail(transaction: Transaction, account: Account, issue: MailIssue) {
    const page = issue.purpose === 'email_verify' ? 'verify-email' : 'reset-password';
    const link = `${new URL(this.env.PUBLIC_ORIGIN).origin}/${page}#token=${issue.rawToken}`;
    const message = {
      to: account.email,
      subject: issue.purpose === 'email_verify' ? '验证你的清蒸云鸭邮箱' : '重置清蒸云鸭登录密码',
      text: `你好，${account.username}\n\n请打开以下链接${issue.purpose === 'email_verify' ? '验证邮箱' : '重置密码'}，链接将在 30 分钟后过期\n\n${link}\n\n如果这不是你的操作，请忽略这封邮件`,
    };
    await transaction
      .update(authTokens)
      .set({ consumedAt: sql`clock_timestamp()` })
      .where(
        and(
          eq(authTokens.userId, account.id),
          eq(authTokens.purpose, issue.purpose),
          isNull(authTokens.consumedAt),
        ),
      );
    const [issued] = await transaction
      .insert(authTokens)
      .values({
        userId: account.id,
        purpose: issue.purpose,
        tokenHash: issue.tokenHash,
        expiresAt: new Date(Date.now() + 1800_000),
      })
      .returning({ id: authTokens.id });
    if (!issued) throw Error('AUTH_TOKEN_INSERT_FAILED');
    await enqueueMail(transaction, this.env.APP_ENCRYPTION_KEY, message, {
      purpose: issue.purpose,
      userId: account.id,
      tokenId: issued.id,
    });
    await transaction.insert(authAuditEvents).values({
      event: `auth.${issue.purpose}_requested`,
      requestId: issue.requestId,
      userId: account.id,
    });
  }
  private async checkRegistration(transaction: Transaction, expected: RegistrationExpectation) {
    await assertOrdinaryWriteAllowed(transaction);
    const [settings] = await transaction
      .select()
      .from(siteSettings)
      .where(eq(siteSettings.key, 'accounts'))
      .for('share');
    if (!settings) throw new BusinessError('SERVICE_UNAVAILABLE', '注册策略尚未完成初始化');
    const policy = accountSettings(settings.value, this.env);
    if (settings.revision !== expected.accountsRevision)
      throw new BusinessError(
        'REVISION_CONFLICT',
        '注册策略已变化，输入已保留，请重新读取后再确认注册',
      );
    if (!policy.registrationEnabled)
      throw new BusinessError('SERVICE_UNAVAILABLE', '注册暂未开放，请稍后再来');
    const [mail] = await transaction
      .select()
      .from(siteSettings)
      .where(eq(siteSettings.key, 'mail'))
      .for('share');
    if (!mail || mail.revision !== expected.mailRevision)
      throw new BusinessError('REVISION_CONFLICT', '邮件配置已变化，请重新确认注册');
    const configured = StoredMailSettingsSchema.parse(mail.value);
    if (
      configured.mode === 'disabled' ||
      (configured.mode === 'environment' && !environmentMail(this.env))
    )
      throw new BusinessError('SERVICE_UNAVAILABLE', '邮件服务暂时不可用，请稍后重试');
  }
  async requestRegistrationCode(email: string, expected: RegistrationExpectation) {
    await this.database.db.transaction(async (transaction) => {
      await this.checkRegistration(transaction, expected);
      const [occupied] = await transaction
        .select({ status: users.status, emailVerifiedAt: users.emailVerifiedAt })
        .from(users)
        .where(eq(users.email, email));
      if (!occupied || (occupied.status === 'active' && !occupied.emailVerifiedAt))
        await issueEmailCode(transaction, this.env.APP_ENCRYPTION_KEY, {
          purpose: 'registration',
          email,
        });
    });
  }
  async register(
    input: { username: string; email: string; passwordHash: string },
    code: string,
    expected: RegistrationExpectation,
    legacyPasswordHash?: string,
  ) {
    await this.database.db.transaction(async (transaction) => {
      await this.checkRegistration(transaction, expected);
      await consumeEmailCode(
        transaction,
        this.env.APP_ENCRYPTION_KEY,
        { purpose: 'registration', email: input.email },
        code,
      );
      const [account] = await transaction
        .insert(users)
        .values({ ...input, emailVerifiedAt: sql`clock_timestamp()` })
        .onConflictDoNothing()
        .returning({ id: users.id });
      if (!account && legacyPasswordHash) {
        const [verified] = await transaction
          .update(users)
          .set({ emailVerifiedAt: sql`clock_timestamp()` })
          .where(
            and(
              eq(users.email, input.email),
              eq(users.username, input.username),
              eq(users.passwordHash, legacyPasswordHash),
              eq(users.status, 'active'),
              isNull(users.emailVerifiedAt),
            ),
          )
          .returning({ id: users.id });
        if (verified) {
          await transaction
            .update(authSessions)
            .set({ revokedAt: sql`clock_timestamp()` })
            .where(and(eq(authSessions.userId, verified.id), isNull(authSessions.revokedAt)));
          await transaction
            .update(authTokens)
            .set({ consumedAt: sql`clock_timestamp()` })
            .where(
              and(
                eq(authTokens.userId, verified.id),
                eq(authTokens.purpose, 'email_verify'),
                isNull(authTokens.consumedAt),
              ),
            );
          await recordSecurityEvent(
            transaction,
            verified.id,
            expected.requestId,
            'auth.email_verify_completed',
          );
          return;
        }
      }
      if (!account) throw new BusinessError('CONFLICT', '用户名或邮箱不可用，请核对后重试');
      await transaction.insert(authAuditEvents).values({
        userId: account.id,
        event: 'auth.registration_requested',
        requestId: expected.requestId,
      });
    });
  }
  async requestMail(email: string, issue: MailIssue) {
    await this.database.db.transaction(async (transaction) => {
      const [account] = await transaction
        .select()
        .from(users)
        .where(eq(users.email, email))
        .for('update');
      if (
        !account ||
        account.status !== 'active' ||
        (issue.purpose === 'email_verify' && account.emailVerifiedAt)
      )
        return;
      await this.queueMail(transaction, account, issue);
    });
  }
  async consumeToken(
    purpose: 'email_verify' | 'password_reset',
    hash: string,
    requestId: string,
    passwordHash?: string,
  ) {
    if (purpose === 'password_reset' && !passwordHash) throw new Error('PASSWORD_HASH_REQUIRED');
    return consumeAuthToken(this.database, purpose, hash, async (transaction, identity) => {
      const [account] = await transaction
        .select()
        .from(users)
        .where(eq(users.id, identity.userId))
        .for('update');
      if (!account || account.status !== 'active')
        throw new BusinessError('INVALID_INPUT', '验证链接已失效，请重新申请');
      await transaction
        .update(users)
        .set(
          purpose === 'email_verify'
            ? { emailVerifiedAt: sql`clock_timestamp()` }
            : { passwordHash },
        )
        .where(eq(users.id, account.id));
      await transaction
        .update(authSessions)
        .set({ revokedAt: sql`clock_timestamp()` })
        .where(and(eq(authSessions.userId, account.id), isNull(authSessions.revokedAt)));
      if (purpose === 'password_reset')
        await transaction
          .update(authTokens)
          .set({ consumedAt: sql`clock_timestamp()` })
          .where(and(eq(authTokens.userId, account.id), isNull(authTokens.consumedAt)));
      await recordSecurityEvent(transaction, account.id, requestId, `auth.${purpose}_completed`);
    });
  }
  private async insertSession(
    transaction: Transaction,
    account: Account,
    issue: SessionIssue,
    restricted: boolean,
    mfaVerified: boolean,
  ) {
    const [settings] = await transaction
      .select()
      .from(siteSettings)
      .where(eq(siteSettings.key, 'accounts'));
    if (!settings) throw new Error('ACCOUNT_SETTINGS_MISSING');
    const lifetime = accountSettings(settings.value, this.env).sessionTtlSeconds;
    const [session] = await transaction
      .insert(authSessions)
      .values({
        ...issue,
        userId: account.id,
        securityVersion: account.securityVersion,
        restricted,
        mfaVerifiedAt: mfaVerified ? new Date() : null,
        expiresAt: new Date(Date.now() + (restricted ? 600 : lifetime) * 1000),
      })
      .returning();
    if (!session) throw new Error('SESSION_INSERT_FAILED');
    const keep = await transaction
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(and(eq(authSessions.userId, account.id), isNull(authSessions.revokedAt)))
      .orderBy(desc(authSessions.createdAt))
      .offset(20);
    for (const row of keep)
      await transaction
        .update(authSessions)
        .set({ revokedAt: sql`clock_timestamp()` })
        .where(eq(authSessions.id, row.id));
    return session;
  }
  async login(account: Account, issue: SessionIssue, requestId: string, previousHash?: string) {
    return this.database.db.transaction(async (transaction) => {
      const [current] = await transaction
        .select()
        .from(users)
        .where(eq(users.id, account.id))
        .for('update');
      if (
        !current ||
        current.status !== 'active' ||
        current.passwordHash !== account.passwordHash ||
        current.securityVersion !== account.securityVersion
      )
        throw new BusinessError('UNAUTHENTICATED', '账号或密码不正确');
      const [mfa] = await transaction.select().from(userMfa).where(eq(userMfa.userId, current.id));
      const restricted = Boolean(mfa?.confirmedAt);
      if (previousHash)
        await transaction
          .update(authSessions)
          .set({ revokedAt: sql`clock_timestamp()` })
          .where(eq(authSessions.tokenHash, previousHash));
      const session = await this.insertSession(transaction, current, issue, restricted, false);
      await transaction
        .insert(authAuditEvents)
        .values({ userId: current.id, event: 'auth.login', requestId });
      return { account: current, session, mfaEnrolled: Boolean(mfa?.confirmedAt) };
    });
  }
  async session(hash: string) {
    const [row] = await this.database.db
      .select({ account: users, session: authSessions, mfaEnrolled: userMfa.confirmedAt })
      .from(authSessions)
      .innerJoin(users, eq(users.id, authSessions.userId))
      .leftJoin(userMfa, eq(userMfa.userId, users.id))
      .where(
        and(
          eq(authSessions.tokenHash, hash),
          eq(authSessions.securityVersion, users.securityVersion),
          eq(users.status, 'active'),
          isNull(authSessions.revokedAt),
          sql`${authSessions.expiresAt} > clock_timestamp()`,
        ),
      )
      .limit(1);
    return row ? { ...row, mfaEnrolled: Boolean(row.mfaEnrolled) } : undefined;
  }
  async reauthenticate(
    identity: { account: Account; session: Session; mfaEnrolled: boolean },
    issue: SessionIssue,
    requestId: string,
  ) {
    return this.database.db.transaction(async (transaction) => {
      const { account, session } = await lockIdentity(transaction, identity, false, false);
      const [mfa] = await transaction.select().from(userMfa).where(eq(userMfa.userId, account.id));
      if (mfa?.confirmedAt)
        throw new BusinessError('MFA_REQUIRED', '请使用已绑定的身份验证器或恢复码');
      if (account.passwordHash !== identity.account.passwordHash)
        throw new BusinessError('UNAUTHENTICATED', '登录状态已失效，请重新登录');
      await transaction
        .update(authSessions)
        .set({ revokedAt: sql`clock_timestamp()` })
        .where(eq(authSessions.id, session.id));
      const next = await this.insertSession(transaction, account, issue, false, false);
      await transaction
        .insert(authAuditEvents)
        .values({ userId: account.id, event: 'auth.password_reauthenticated', requestId });
      return { account, session: next, mfaEnrolled: false };
    });
  }
  async logout(userId: string, sessionId: string | undefined, requestId: string) {
    await this.database.db.transaction(async (transaction) => {
      // 审计写入也会取得账号外键锁，所有退出路径统一按账号 → 会话获取锁。
      const [account] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .for('update');
      if (!account) throw new BusinessError('UNAUTHENTICATED', '登录状态已失效，请重新登录');
      if (!sessionId)
        await transaction
          .update(users)
          .set({ securityVersion: sql`${users.securityVersion}+1` })
          .where(eq(users.id, userId));
      const revoked = await transaction
        .update(authSessions)
        .set({ revokedAt: sql`clock_timestamp()` })
        .where(
          and(
            eq(authSessions.userId, userId),
            ...(sessionId ? [eq(authSessions.id, sessionId)] : []),
          ),
        )
        .returning({ id: authSessions.id });
      if (sessionId && revoked.length === 0) throw new BusinessError('NOT_FOUND', '会话不存在');
      await transaction
        .insert(authAuditEvents)
        .values({ userId, event: sessionId ? 'auth.logout' : 'auth.logout_all', requestId });
    });
  }
  listSessions(userId: string) {
    return this.database.db
      .select({
        id: authSessions.id,
        createdAt: authSessions.createdAt,
        expiresAt: authSessions.expiresAt,
        deviceName: authSessions.deviceName,
      })
      .from(authSessions)
      .innerJoin(users, eq(users.id, authSessions.userId))
      .where(
        and(
          eq(authSessions.userId, userId),
          eq(authSessions.securityVersion, users.securityVersion),
          isNull(authSessions.revokedAt),
          sql`${authSessions.expiresAt}>clock_timestamp()`,
        ),
      )
      .orderBy(desc(authSessions.createdAt))
      .limit(20);
  }
  async mfa(userId: string) {
    return (await this.database.db.select().from(userMfa).where(eq(userMfa.userId, userId)))[0];
  }
  async prepareMfa(userId: string, encryptedSecret: string) {
    await this.database.db.transaction(async (transaction) => {
      await transaction
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .for('update');
      const [current] = await transaction.select().from(userMfa).where(eq(userMfa.userId, userId));
      if (current?.confirmedAt) throw new BusinessError('CONFLICT', '二次验证已启用');
      await transaction
        .insert(userMfa)
        .values({ userId, encryptedSecret, pendingExpiresAt: new Date(Date.now() + 600_000) })
        .onConflictDoUpdate({
          target: userMfa.userId,
          set: {
            encryptedSecret,
            pendingExpiresAt: new Date(Date.now() + 600_000),
            lastCounter: -1,
          },
        });
    });
  }
  async finishMfa(
    identity: { account: Account; session: Session },
    encryptedSecret: string,
    proof: { counter?: number; recoveryHash?: string },
    confirm: boolean,
    issue: SessionIssue,
    requestId: string,
    recoveryHashes: string[] = [],
  ) {
    return this.database.db.transaction(async (transaction) => {
      const [account] = await transaction
        .select()
        .from(users)
        .where(eq(users.id, identity.account.id))
        .for('update');
      const [session] = await transaction
        .select()
        .from(authSessions)
        .where(eq(authSessions.id, identity.session.id))
        .for('update');
      const [mfa] = await transaction
        .select()
        .from(userMfa)
        .where(eq(userMfa.userId, identity.account.id))
        .for('update');
      if (
        !account ||
        account.status !== 'active' ||
        !session ||
        session.revokedAt ||
        session.expiresAt <= new Date() ||
        session.securityVersion !== account.securityVersion ||
        !mfa ||
        mfa.encryptedSecret !== encryptedSecret ||
        (confirm
          ? Boolean(mfa.confirmedAt) || mfa.pendingExpiresAt <= new Date()
          : !mfa.confirmedAt)
      )
        throw new BusinessError('UNAUTHENTICATED', '登录状态已失效，请重新登录');
      if (proof.recoveryHash && !confirm) {
        const [used] = await transaction
          .update(mfaRecoveryCodes)
          .set({ consumedAt: sql`clock_timestamp()` })
          .where(
            and(
              eq(mfaRecoveryCodes.userId, account.id),
              eq(mfaRecoveryCodes.codeHash, proof.recoveryHash),
              isNull(mfaRecoveryCodes.consumedAt),
            ),
          )
          .returning({ userId: mfaRecoveryCodes.userId });
        if (!used) throw new BusinessError('INVALID_INPUT', '验证码无效或已使用');
      } else {
        if (proof.counter === undefined || proof.counter <= mfa.lastCounter)
          throw new BusinessError('INVALID_INPUT', '验证码无效或已使用');
        await transaction
          .update(userMfa)
          .set({ lastCounter: proof.counter, ...(confirm ? { confirmedAt: new Date() } : {}) })
          .where(eq(userMfa.userId, account.id));
      }
      let updated = account;
      if (confirm) {
        const [row] = await transaction
          .update(users)
          .set({ securityVersion: sql`${users.securityVersion}+1` })
          .where(eq(users.id, account.id))
          .returning();
        if (!row) throw new Error('ACCOUNT_UPDATE_FAILED');
        updated = row;
        await transaction
          .update(authSessions)
          .set({ revokedAt: sql`clock_timestamp()` })
          .where(eq(authSessions.userId, account.id));
        await transaction
          .insert(mfaRecoveryCodes)
          .values(recoveryHashes.map((codeHash) => ({ userId: account.id, codeHash })));
      } else
        await transaction
          .update(authSessions)
          .set({ revokedAt: sql`clock_timestamp()` })
          .where(eq(authSessions.id, session.id));
      const next = await this.insertSession(transaction, updated, issue, false, true);
      await recordSecurityEvent(
        transaction,
        account.id,
        requestId,
        confirm
          ? 'auth.mfa_enrolled'
          : proof.recoveryHash
            ? 'auth.mfa_recovery_used'
            : 'auth.mfa_verified',
      );
      return { account: updated, session: next, mfaEnrolled: true };
    });
  }
}
