import { Inject, Injectable } from '@nestjs/common';
import {
  IdSchema,
  type AccountSettingsUpdate,
  type AccountSettingsRecordsQuery,
} from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import type { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service.js';
import {
  AccountSettingsRepository,
  normalizeAccountSettingsUpdate,
} from './account-settings.repository.js';

@Injectable()
export class AccountSettingsService {
  constructor(
    @Inject(AuthService) readonly auth: AuthService,
    @Inject(AccountSettingsRepository) readonly repository: AccountSettingsRepository,
  ) {}
  private async actor(request: Request, writing = false) {
    const actor = await this.auth.administrator(request, 'session');
    const expected = request.get('x-expected-account');
    if (
      expected !== undefined &&
      (!IdSchema.safeParse(expected).success || expected.toLowerCase() !== actor.account.id)
    )
      throw new BusinessError('CONFLICT', '登录账号已变化，请重新核对账户策略');
    await this.auth.rate.take(
      writing ? 'account-settings-write' : 'account-settings-read',
      actor.account.id,
      writing ? 30 : 120,
      60,
    );
    return actor;
  }
  read(request: Request) {
    return this.actor(request).then((actor) => this.repository.read(actor));
  }
  records(request: Request, input: AccountSettingsRecordsQuery) {
    return this.actor(request).then((actor) => this.repository.records(actor, input));
  }
  async update(request: Request, response: Response, value: AccountSettingsUpdate) {
    const actor = await this.actor(request, true);
    const match = /^"accounts-([1-9]\d{0,9})"$/u.exec(request.get('if-match') ?? '');
    if (!match?.[1])
      throw new BusinessError('REVISION_CONFLICT', '请重新读取账户策略并提供有效If-Match');
    const expected = Number(match[1]);
    const raw = request.get('idempotency-key'),
      parsed = raw === undefined ? undefined : IdSchema.safeParse(raw);
    if (parsed && !parsed.success)
      throw new BusinessError('INVALID_INPUT', '请提供有效的保存幂等标识');
    const key = parsed?.success ? parsed.data.toLowerCase() : undefined;
    const input = normalizeAccountSettingsUpdate(value);
    if (key) {
      const receipt = await this.repository.replay(actor, input, expected, key);
      if (receipt) return receipt;
    }
    this.auth.requireRecentVerification(actor);
    const mailRevision = input.data.registrationEnabled
      ? await this.auth.registrationMailRevision()
      : undefined;
    return this.repository.update(
      actor,
      input,
      expected,
      key,
      this.auth.requestId(response),
      mailRevision,
    );
  }
}
