import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  assertNewPassword,
  BusinessError,
  hashAuthSecret,
  hashPassword,
  issueAuthSecret,
  verifyPassword,
} from '@personamarket/server';
import { AuthService } from '../auth/auth.service.js';
import { SecurityRepository } from './security.repository.js';
@Injectable()
export class SecurityService {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SecurityRepository) private readonly repository: SecurityRepository,
  ) {}
  private async authorize(password: string, scope: string, request: Request) {
    const identity = await this.auth.identity(request);
    this.auth.requireRecentVerification(identity);
    await this.auth.rate.take('security-' + scope, identity.account.id, 5, 900);
    if (!(await verifyPassword(identity.account.passwordHash, password)))
      throw new BusinessError('UNAUTHENTICATED', '当前密码不正确');
    return identity;
  }
  async password(
    input: { currentPassword: string; newPassword: string },
    request: Request,
    response: Response,
  ) {
    const identity = await this.authorize(input.currentPassword, 'password', request);
    assertNewPassword(input.newPassword, identity.account);
    if (input.currentPassword === input.newPassword)
      throw new BusinessError('INVALID_INPUT', '新密码需要与当前密码不同');
    await this.repository.password(
      identity,
      await hashPassword(input.newPassword),
      this.auth.requestId(response),
    );
    return { data: { message: '密码已更新，所有设备都需要重新登录' } };
  }
  async email(
    input: { currentPassword: string; email: string },
    request: Request,
    response: Response,
  ) {
    const identity = await this.authorize(input.currentPassword, 'email', request);
    await this.auth.requireMail();
    await this.auth.rate.take('mail-recipient', input.email, 3, 900);
    await this.repository.email(
      identity,
      input.email,
      issueAuthSecret('email_change'),
      this.auth.requestId(response),
    );
    return { data: { message: '如果新邮箱可用，确认邮件将发送到该地址，确认前账号仍使用原邮箱' } };
  }
  async confirmEmail(token: string, response: Response) {
    const hash = hashAuthSecret('email_change', token);
    if (!hash) throw new BusinessError('INVALID_INPUT', '确认链接已失效，请重新申请');
    await this.repository.confirmEmail(hash, this.auth.requestId(response));
    return { data: { message: '新邮箱已确认，请使用新邮箱或用户名重新登录' } };
  }
  async deactivation(request: Request) {
    const identity = await this.auth.identity(request);
    return this.repository.deactivation(identity.account.id);
  }
  async requestDeactivation(
    input: { currentPassword: string; reason: string },
    request: Request,
    response: Response,
  ) {
    const identity = await this.authorize(input.currentPassword, 'deactivation', request);
    await this.repository.requestDeactivation(
      identity,
      input.reason,
      this.auth.requestId(response),
    );
    return { data: { message: '停用申请已提交，处理前账号保持可用，你可以随时撤回' } };
  }
  async withdraw(request: Request, response: Response) {
    const identity = await this.auth.identity(request);
    this.auth.requireRecentVerification(identity);
    const changed = await this.repository.withdrawDeactivation(
      identity,
      this.auth.requestId(response),
    );
    return { data: { message: changed ? '停用申请已撤回' : '当前没有待处理的停用申请' } };
  }
}
