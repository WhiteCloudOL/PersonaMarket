import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { Request, Response } from 'express';
import { type AuthContextResponse } from '@personamarket/contracts';
import type { Database } from '@personamarket/database';
import {
  BusinessError,
  dummyPasswordHash,
  hashAuthSecret,
  hashPassword,
  issueAuthSecret,
  MailSender,
  MailConfigurationStore,
  readAccountSettings,
  readSystemSettings,
  assertOrdinaryRequestAllowed,
  SystemConfigurationUnavailableError,
  registrationRateScope,
  assertNewPassword,
  verifyPassword,
  type ServerEnvironment,
} from '@personamarket/server';
import { DATABASE, ENVIRONMENT } from '../tokens.js';
import { AuthRepository, type Account, type SessionIssue } from './auth.repository.js';
import { AuthRateLimit } from './rate-limit.service.js';
import { requireRecentVerification as assertRecentVerification } from './verification-policy.js';
import {
  cookieName,
  csrfHeader,
  ensureCsrf,
  readCookie,
  setAuthCookie,
} from './cookie-security.js';

export type Identity = NonNullable<Awaited<ReturnType<AuthRepository['session']>>>;
@Injectable()
export class AuthService implements OnApplicationShutdown {
  private readonly sender;
  private readonly mailSettings;
  private mailStatus: { ready: boolean; until: number; revision: number } | undefined;
  private checkingMail: { revision: number; promise: Promise<boolean> } | undefined;
  constructor(
    @Inject(AuthRepository) readonly repository: AuthRepository,
    @Inject(ENVIRONMENT) readonly env: ServerEnvironment,
    @Inject(AuthRateLimit) readonly rate: AuthRateLimit,
    @Inject(DATABASE) private readonly database: Database,
  ) {
    this.mailSettings = new MailConfigurationStore(database, env);
    this.sender = new MailSender(env, () => this.mailSettings.current());
  }
  onApplicationShutdown() {
    this.sender.close();
  }
  private async mailReady() {
    const { row, connection } = await this.mailSettings.read();
    if (
      this.mailStatus &&
      this.mailStatus.revision === row.revision &&
      this.mailStatus.until > Date.now()
    )
      return this.mailStatus.ready;
    if (this.checkingMail?.revision === row.revision) return this.checkingMail.promise;
    if (!connection) return false;
    const sender = new MailSender(this.env, async () => connection);
    const checking: Promise<boolean> = sender
      .ready()
      .then((ready) => {
        if (this.checkingMail?.revision === row.revision)
          this.mailStatus = { ready, until: Date.now() + 15000, revision: row.revision };
        return ready;
      })
      .finally(() => {
        sender.close();
        if (this.checkingMail?.promise === checking) this.checkingMail = undefined;
      });
    this.checkingMail = { revision: row.revision, promise: checking };
    return checking;
  }
  /** 就绪检查绑定一份连接快照，返回其修订供最终写事务核对。 */
  async registrationMailRevision() {
    const { row, connection } = await this.mailSettings.read();
    if (!connection)
      throw new BusinessError('SERVICE_UNAVAILABLE', '邮件服务暂时不可用，请稍后重试');
    const sender = new MailSender(this.env, async () => connection);
    try {
      if (!(await sender.ready()))
        throw new BusinessError('SERVICE_UNAVAILABLE', '邮件服务暂时不可用，请稍后重试');
      return row.revision;
    } finally {
      sender.close();
    }
  }
  async requireMail() {
    if (!(await this.sender.ready()))
      throw new BusinessError('SERVICE_UNAVAILABLE', '邮件服务暂时不可用，请稍后重试');
  }
  requireRecentVerification(identity: Identity) {
    assertRecentVerification(identity);
  }
  async administrator(request: Request, verification: 'session' | 'recent' = 'recent') {
    const identity = await this.identity(request);
    if (identity.account.role !== 'admin')
      throw new BusinessError('FORBIDDEN', '此操作需要管理员权限');
    if (verification === 'recent') this.requireRecentVerification(identity);
    return identity;
  }
  requestId(response: Response) {
    const value: unknown = response.locals['requestId'];
    if (typeof value !== 'string') throw new Error('REQUEST_ID_MISSING');
    return value;
  }
  async identity(request: Request, complete = true): Promise<Identity> {
    const token = readCookie(request, cookieName(this.env, 'session'));
    const hash = token && hashAuthSecret('session', token);
    const identity = hash ? await this.repository.session(hash) : undefined;
    if (!identity) throw new BusinessError('UNAUTHENTICATED', '登录状态已失效，请重新登录');
    if (complete && this.assurance(identity) !== 'authenticated')
      throw new BusinessError('FORBIDDEN', '请先完成二次验证');
    if (!['GET', 'HEAD'].includes(request.method)) {
      const seed = readCookie(request, cookieName(this.env, 'csrf'));
      if (!seed || hashAuthSecret('csrf', seed) !== identity.session.csrfTokenHash)
        throw new BusinessError('FORBIDDEN', '请求校验失败，请刷新页面后重试');
    }
    return identity;
  }
  assurance(identity: Identity) {
    return identity.mfaEnrolled && (identity.session.restricted || !identity.session.mfaVerifiedAt)
      ? ('mfa_required' as const)
      : ('authenticated' as const);
  }
  async reauthenticate(password: string, request: Request, response: Response) {
    const identity = await this.identity(request);
    if (identity.mfaEnrolled)
      throw new BusinessError('MFA_REQUIRED', '请使用已绑定的身份验证器或恢复码');
    await this.rate.take('password-reauth-account', identity.account.id, 5, 900);
    await this.rate.take('password-reauth-ip', request.ip ?? 'unknown', 20, 900);
    if (!(await verifyPassword(identity.account.passwordHash, password)))
      throw new BusinessError('INVALID_INPUT', '当前密码不正确');
    const issue = this.issue(request);
    const result = await this.repository.reauthenticate(
      identity,
      issue.record,
      this.requestId(response),
    );
    this.applySession(response, issue, result.session.expiresAt);
    return { data: { message: '身份已确认，请重试刚才的操作' } };
  }
  account(account: Account) {
    return {
      id: account.id,
      username: account.username,
      email: account.email,
      emailVerified: Boolean(account.emailVerifiedAt),
      role: account.role,
      status: account.status,
    };
  }
  async context(request: Request, response: Response): Promise<AuthContextResponse> {
    const policy = await readAccountSettings(this.database, this.env);
    let ordinaryAvailable = false;
    try {
      ordinaryAvailable = !(await readSystemSettings(this.database)).data.maintenanceEnabled;
    } catch (cause) {
      // 独立配置损坏只关闭注册引导；不能阻断CSRF、登录、MFA和必要恢复。
      if (!(cause instanceof SystemConfigurationUnavailableError)) throw cause;
    }
    const token = readCookie(request, cookieName(this.env, 'session'));
    const hash = token && hashAuthSecret('session', token);
    const identity = hash ? await this.repository.session(hash) : undefined;
    let seed = readCookie(request, cookieName(this.env, 'csrf'));
    if (!seed || (identity && hashAuthSecret('csrf', seed) !== identity.session.csrfTokenHash)) {
      const fresh = issueAuthSecret('csrf');
      seed = fresh.token;
      if (identity) await this.repository.updateCsrf(identity.session.id, fresh.hash);
    }
    setAuthCookie(this.env, response, 'csrf', seed, 86400_000);
    return {
      data: {
        csrfToken: csrfHeader(this.env, seed, token),
        account: identity ? this.account(identity.account) : null,
        assurance: identity ? this.assurance(identity) : 'anonymous',
        registrationAvailable:
          ordinaryAvailable && policy.data.registrationEnabled && (await this.mailReady()),
        registrationPolicy: {
          verificationEmailTiming: policy.data.verificationEmailTiming,
          settingsRevision: policy.meta.revision,
        },
        mfaEnabled: identity?.mfaEnrolled ?? false,
        sessionExpiresAt: identity?.session.expiresAt.toISOString() ?? null,
      },
    };
  }
  issue(request: Request) {
    const secret = issueAuthSecret('session');
    const csrf = issueAuthSecret('csrf');
    const record: SessionIssue = {
      id: randomUUID(),
      tokenHash: secret.hash,
      csrfTokenHash: csrf.hash,
      deviceName: (request.get('user-agent') ?? '未知设备').slice(0, 200),
    };
    return { record, token: secret.token, csrf: csrf.token };
  }
  applySession(response: Response, issue: ReturnType<AuthService['issue']>, expiresAt: Date) {
    setAuthCookie(
      this.env,
      response,
      'session',
      issue.token,
      Math.max(0, expiresAt.getTime() - Date.now()),
    );
    setAuthCookie(this.env, response, 'csrf', issue.csrf, 86400_000);
  }
  async register(
    input: { username: string; email: string; password: string },
    request: Request,
    response: Response,
  ) {
    await this.rate.take('register-ip', request.ip ?? 'unknown', 10, 3600);
    await assertOrdinaryRequestAllowed(this.database);
    const policy = await readAccountSettings(this.database, this.env);
    if (!policy.data.registrationEnabled)
      throw new BusinessError('SERVICE_UNAVAILABLE', '注册暂未开放，请稍后再来');
    await this.rate.take(
      registrationRateScope(policy.data.registrationRateLimit),
      request.ip ?? 'unknown',
      policy.data.registrationRateLimit.maxAttempts,
      policy.data.registrationRateLimit.windowSeconds,
    );
    const automatic = policy.data.verificationEmailTiming === 'on_registration';
    if (automatic) await this.rate.take('mail-recipient', input.email, 3, 900);
    const mailRevision = await this.registrationMailRevision();
    assertNewPassword(input.password, input);
    const passwordHash = await hashPassword(input.password);
    const token = automatic ? issueAuthSecret('email_verify') : undefined;
    const result = await this.repository.register(
      { username: input.username, email: input.email, passwordHash },
      token
        ? {
            tokenHash: token.hash,
            rawToken: token.token,
            purpose: 'email_verify',
            requestId: this.requestId(response),
          }
        : undefined,
      { accountsRevision: policy.meta.revision, mailRevision, requestId: this.requestId(response) },
    );
    return {
      data: {
        message:
          result.verificationEmailTiming === 'on_registration'
            ? '如果注册信息可用，验证邮件将发送到你的邮箱；你也可以先登录并编辑私有草稿'
            : '如果注册信息可用，你可以登录账号并主动申请验证邮件；公开投稿和互动前仍需验证邮箱',
      },
    };
  }
  async requestMail(
    email: string,
    purpose: 'email_verify' | 'password_reset',
    request: Request,
    response: Response,
  ) {
    await this.rate.take('mail-recipient', email, 3, 900);
    await this.rate.take('mail-ip', request.ip ?? 'unknown', 10, 3600);
    await this.requireMail();
    const token = issueAuthSecret(purpose);
    await this.repository.requestMail(email, {
      purpose,
      tokenHash: token.hash,
      rawToken: token.token,
      requestId: this.requestId(response),
    });
    return { data: { message: '如果该邮箱可以接收邮件，我们会发送下一步操作说明' } };
  }
  async consumeToken(
    rawToken: string,
    purpose: 'email_verify' | 'password_reset',
    response: Response,
    password?: string,
  ) {
    const hash = hashAuthSecret(purpose, rawToken);
    if (!hash) throw new BusinessError('INVALID_INPUT', '验证链接已失效，请重新申请');
    if (password) {
      const account = await this.repository.tokenAccount(purpose, hash);
      if (!account) throw new BusinessError('INVALID_INPUT', '验证链接已失效，请重新申请');
      assertNewPassword(password, account);
    }
    const encoded = password ? await hashPassword(password) : undefined;
    const result = await this.repository.consumeToken(
      purpose,
      hash,
      this.requestId(response),
      encoded,
    );
    if (!result.consumed) throw new BusinessError('INVALID_INPUT', '验证链接已失效，请重新申请');
    return {
      data: {
        message: purpose === 'email_verify' ? '邮箱验证成功，可以登录了' : '密码已重置，请重新登录',
      },
    };
  }
  async login(
    input: { identifier: string; password: string },
    request: Request,
    response: Response,
  ) {
    await this.rate.take('login-ip', request.ip ?? 'unknown', 30, 900);
    await this.rate.take('login-identifier', input.identifier, 5, 900);
    const account = await this.repository.findAccount(input.identifier);
    const valid = await verifyPassword(
      account?.passwordHash ?? (await dummyPasswordHash()),
      input.password,
    );
    if (!valid || !account || account.status !== 'active') {
      await this.repository.audit('auth.login_failed', this.requestId(response));
      throw new BusinessError('UNAUTHENTICATED', '账号或密码不正确');
    }
    const issue = this.issue(request);
    const previous = readCookie(request, cookieName(this.env, 'session'));
    const result = await this.repository.login(
      account,
      issue.record,
      this.requestId(response),
      previous ? (hashAuthSecret('session', previous) ?? undefined) : undefined,
    );
    this.applySession(response, issue, result.session.expiresAt);
    return {
      data: { message: this.assurance(result) === 'authenticated' ? '登录成功' : '请完成二次验证' },
    };
  }
  async logout(request: Request, response: Response, all = false, targetId?: string) {
    const identity = await this.identity(request, false);
    if (targetId && this.assurance(identity) !== 'authenticated')
      throw new BusinessError('FORBIDDEN', '请先完成二次验证');
    await this.repository.logout(
      identity.account.id,
      all ? undefined : (targetId ?? identity.session.id),
      this.requestId(response),
    );
    if (all || !targetId || targetId === identity.session.id) {
      setAuthCookie(this.env, response, 'session', '', 0);
      ensureCsrf(this.env, request, response, true);
    }
    return { data: { message: all ? '已退出全部设备' : '会话已退出' } };
  }
  async sessions(request: Request) {
    const identity = await this.identity(request);
    const rows = await this.repository.listSessions(identity.account.id);
    return {
      data: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        current: row.id === identity.session.id,
      })),
    };
  }
}
