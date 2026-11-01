import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  authSessions,
  authTokens,
  consumeAuthToken,
  deactivationRequests,
  users,
  type Database,
} from '@personamarket/database';
import { BusinessError, enqueueMail, type ServerEnvironment } from '@personamarket/server';
import { DATABASE, ENVIRONMENT } from '../tokens.js';
import type { Identity } from '../auth/auth.service.js';
import { lockIdentity, type Transaction } from '../auth/locked-identity.js';
import { recordSecurityEvent } from '../auth/security-notification.js';
@Injectable()
export class SecurityRepository {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENVIRONMENT) private readonly env: ServerEnvironment,
  ) {}
  private async revoke(transaction: Transaction, userId: string) {
    await transaction
      .update(authSessions)
      .set({ revokedAt: sql`clock_timestamp()` })
      .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)));
    await transaction
      .update(authTokens)
      .set({ consumedAt: sql`clock_timestamp()` })
      .where(and(eq(authTokens.userId, userId), isNull(authTokens.consumedAt)));
  }
  private async audit(transaction: Transaction, userId: string, requestId: string, event: string) {
    return recordSecurityEvent(transaction, userId, requestId, event);
  }
  private async notify(
    transaction: Transaction,
    account: Identity['account'],
    subject: string,
    text: string,
    auditId: string,
  ) {
    if (account.emailVerifiedAt)
      await enqueueMail(
        transaction,
        this.env.APP_ENCRYPTION_KEY,
        {
          to: account.email,
          subject,
          text,
        },
        {
          purpose: 'security_notice',
          userId: account.id,
          sourceType: 'auth_audit',
          sourceId: auditId,
        },
      );
  }
  async password(identity: Identity, passwordHash: string, requestId: string) {
    await this.database.db.transaction(async (transaction) => {
      const { account } = await lockIdentity(transaction, identity);
      if (account.passwordHash !== identity.account.passwordHash)
        throw new BusinessError('CONFLICT', '账号安全信息已变化，请重新登录');
      await transaction.update(users).set({ passwordHash }).where(eq(users.id, account.id));
      await this.revoke(transaction, account.id);
      const auditId = await this.audit(transaction, account.id, requestId, 'auth.password_changed');
      await this.notify(
        transaction,
        account,
        '清蒸云鸭账号密码已更新',
        '你的登录密码已更新，所有设备会话与旧安全链接已失效，如非本人操作，请立即通过站点找回密码',
        auditId,
      );
    });
  }
  async email(
    identity: Identity,
    email: string,
    token: { hash: string; token: string },
    requestId: string,
  ) {
    await this.database.db.transaction(async (transaction) => {
      const { account } = await lockIdentity(transaction, identity);
      if (account.email === email) throw new BusinessError('INVALID_INPUT', '请填写不同的新邮箱');
      const [occupied] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email));
      if (occupied) return;
      await transaction
        .update(authTokens)
        .set({ consumedAt: sql`clock_timestamp()` })
        .where(
          and(
            eq(authTokens.userId, account.id),
            eq(authTokens.purpose, 'email_change'),
            isNull(authTokens.consumedAt),
          ),
        );
      const [issued] = await transaction
        .insert(authTokens)
        .values({
          userId: account.id,
          purpose: 'email_change',
          tokenHash: token.hash,
          targetEmail: email,
          expiresAt: new Date(Date.now() + 1800_000),
        })
        .returning({ id: authTokens.id });
      if (!issued) throw Error('AUTH_TOKEN_INSERT_FAILED');
      const link = new URL(this.env.PUBLIC_ORIGIN).origin + '/change-email#token=' + token.token;
      await enqueueMail(
        transaction,
        this.env.APP_ENCRYPTION_KEY,
        {
          to: email,
          subject: '确认你的清蒸云鸭新邮箱',
          text:
            '请打开以下链接确认新邮箱，链接将在 30 分钟后过期\n\n' +
            link +
            '\n\n确认前账号仍使用原邮箱',
        },
        { purpose: 'email_change', userId: account.id, tokenId: issued.id },
      );
      const auditId = await this.audit(
        transaction,
        account.id,
        requestId,
        'auth.email_change_requested',
      );
      await this.notify(
        transaction,
        account,
        '清蒸云鸭邮箱变更申请',
        '你的账号发起了邮箱变更申请，确认新邮箱后所有会话将失效，如非本人操作，请立即修改密码以撤销该申请',
        auditId,
      );
    });
  }
  async confirmEmail(hash: string, requestId: string) {
    try {
      const result = await consumeAuthToken(
        this.database,
        'email_change',
        hash,
        async (transaction, token) => {
          const [account] = await transaction
            .select()
            .from(users)
            .where(eq(users.id, token.userId))
            .for('update');
          if (!account || account.status !== 'active' || !token.targetEmail)
            throw new BusinessError('INVALID_INPUT', '确认链接已失效，请重新申请');
          await transaction
            .update(users)
            .set({ email: token.targetEmail, emailVerifiedAt: new Date() })
            .where(eq(users.id, account.id));
          await this.revoke(transaction, account.id);
          const auditId = await this.audit(
            transaction,
            account.id,
            requestId,
            'auth.email_changed',
          );
          await this.notify(
            transaction,
            account,
            '清蒸云鸭邮箱已变更',
            '你的账号邮箱已完成变更，所有旧会话与安全链接均已失效，如有疑问，请联系站点管理员',
            auditId,
          );
        },
      );
      if (!result.consumed) throw new BusinessError('INVALID_INPUT', '确认链接已失效，请重新申请');
    } catch (cause) {
      const error = cause instanceof Error && 'cause' in cause ? cause.cause : cause;
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
        throw new BusinessError('CONFLICT', '邮箱地址暂不可用，请重新申请变更', { cause });
      throw cause;
    }
  }
  async deactivation(userId: string) {
    const [request] = await this.database.db
      .select({
        id: deactivationRequests.id,
        status: deactivationRequests.status,
        reason: deactivationRequests.reason,
        createdAt: deactivationRequests.createdAt,
      })
      .from(deactivationRequests)
      .where(eq(deactivationRequests.userId, userId))
      .orderBy(desc(deactivationRequests.createdAt))
      .limit(1);
    return {
      data: {
        request: request ? { ...request, createdAt: request.createdAt.toISOString() } : null,
      },
    };
  }
  async requestDeactivation(identity: Identity, reason: string, requestId: string) {
    await this.database.db.transaction(async (transaction) => {
      const { account } = await lockIdentity(transaction, identity);
      const [created] = await transaction
        .insert(deactivationRequests)
        .values({ userId: account.id, reason })
        .onConflictDoNothing()
        .returning({ id: deactivationRequests.id });
      if (!created) throw new BusinessError('CONFLICT', '已有待处理的停用申请，请先查看或撤回');
      const auditId = await this.audit(
        transaction,
        account.id,
        requestId,
        'auth.deactivation_requested',
      );
      await this.notify(
        transaction,
        account,
        '清蒸云鸭停用申请已提交',
        '你的账号停用申请已提交，账号在处理前保持可用，你可以在账号安全页面撤回该申请',
        auditId,
      );
    });
  }
  async withdrawDeactivation(identity: Identity, requestId: string) {
    return this.database.db.transaction(async (transaction) => {
      await lockIdentity(transaction, identity);
      const rows = await transaction
        .update(deactivationRequests)
        .set({ status: 'withdrawn', updatedAt: new Date() })
        .where(
          and(
            eq(deactivationRequests.userId, identity.account.id),
            eq(deactivationRequests.status, 'pending'),
          ),
        )
        .returning({ id: deactivationRequests.id });
      if (rows.length)
        await this.audit(
          transaction,
          identity.account.id,
          requestId,
          'auth.deactivation_withdrawn',
        );
      return rows.length > 0;
    });
  }
}
