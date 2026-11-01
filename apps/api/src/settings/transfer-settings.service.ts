import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  IdSchema,
  type TransferSettingsWrite,
  type TransferSettingsRecordsQuery,
} from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import { AuthService } from '../auth/auth.service.js';
import { TransferSettingsRepository } from './transfer-settings.repository.js';

@Injectable()
export class TransferSettingsService {
  constructor(
    @Inject(AuthService) readonly auth: AuthService,
    @Inject(TransferSettingsRepository) readonly repository: TransferSettingsRepository,
  ) {}
  private async actor(request: Request, writing = false) {
    const actor = await this.auth.administrator(request, 'session');
    const expected = request.get('x-expected-account');
    if (
      expected &&
      (!IdSchema.safeParse(expected).success || expected.toLowerCase() !== actor.account.id)
    )
      throw new BusinessError('CONFLICT', '登录账号已变化，请重新确认导入导出设置');
    await this.auth.rate.take(
      writing ? 'transfer-settings-write' : 'transfer-settings-read',
      actor.account.id,
      writing ? 30 : 120,
      60,
    );
    return actor;
  }
  async publicRead(request: Request) {
    await this.auth.rate.take('site-transfer-settings', request.ip ?? 'unknown', 120, 60);
    return this.repository.publicRead();
  }
  async read(request: Request) {
    return this.repository.read(await this.actor(request));
  }
  async records(request: Request, input: TransferSettingsRecordsQuery) {
    return this.repository.records(await this.actor(request), input);
  }
  async update(request: Request, response: Response, input: TransferSettingsWrite) {
    const actor = await this.actor(request, true);
    const match = /^"transfer-([1-9]\d{0,9})"$/.exec(request.get('if-match') ?? '');
    if (!match?.[1])
      throw new BusinessError('INVALID_INPUT', '请先读取导入导出设置并提供对应的 If-Match');
    const key = IdSchema.safeParse(request.get('idempotency-key'));
    if (!key.success) throw new BusinessError('INVALID_INPUT', '请提供有效的操作幂等标识');
    return this.repository.update(
      actor,
      input,
      Number(match[1]),
      key.data.toLowerCase(),
      this.auth.requestId(response),
    );
  }
}
