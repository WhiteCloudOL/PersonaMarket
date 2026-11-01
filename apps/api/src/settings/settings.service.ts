import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { UpdateMailSettings } from '@personamarket/contracts';
import type { Database } from '@personamarket/database';
import {
  BusinessError,
  MailConfigurationStore,
  MailSender,
  type ServerEnvironment,
} from '@personamarket/server';
import { DATABASE, ENVIRONMENT } from '../tokens.js';
import { AuthService } from '../auth/auth.service.js';
import { SettingsRepository } from './settings.repository.js';
@Injectable()
export class SettingsService {
  private readonly mail;
  constructor(
    @Inject(DATABASE) database: Database,
    @Inject(ENVIRONMENT) private readonly env: ServerEnvironment,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SettingsRepository) private readonly repository: SettingsRepository,
  ) {
    this.mail = new MailConfigurationStore(database, env);
  }
  async readMail(request: Request) {
    await this.auth.administrator(request, 'session');
    return this.mail.publicRead();
  }
  private expected(request: Request, group: string) {
    const match = new RegExp('^"' + group + '-([0-9]+)"$').exec(request.get('if-match') ?? '')?.[1];
    if (!match || !Number.isSafeInteger(Number(match)))
      throw new BusinessError('REVISION_CONFLICT', '请刷新设置后重试');
    return Number(match);
  }
  async updateMail(input: UpdateMailSettings, request: Request, response: Response) {
    const actor = await this.auth.administrator(request);
    await this.repository.update(
      'mail',
      input,
      this.expected(request, 'mail'),
      actor,
      this.auth.requestId(response),
    );
    return this.mail.publicRead();
  }
  async testMail(request: Request, response: Response) {
    const actor = await this.auth.administrator(request, 'session');
    if (!actor.account.emailVerifiedAt) throw new BusinessError('FORBIDDEN', '请先验证管理员邮箱');
    await this.auth.rate.take('admin-mail-test', actor.account.id, 3, 900);
    const sender = new MailSender(this.env, () => this.mail.current());
    try {
      await sender.send(randomUUID(), {
        to: actor.account.email,
        subject: '清蒸云鸭邮件配置测试',
        text: '这是一封由你在站点后台发起的测试邮件，用于确认 SMTP 配置可正常投递',
      });
      await this.repository.audit(
        'admin.mail_test_succeeded',
        actor,
        this.auth.requestId(response),
      );
      return {
        data: {
          message: '测试邮件已由 SMTP 服务器接收，请检查管理员邮箱',
          recipient: actor.account.email,
        },
      };
    } catch (cause) {
      await this.repository.audit('admin.mail_test_failed', actor, this.auth.requestId(response));
      throw new BusinessError(
        'SERVICE_UNAVAILABLE',
        '测试发送失败，请检查主机、端口、TLS 和凭据后重试',
        { cause },
      );
    } finally {
      sender.close();
    }
  }
}
