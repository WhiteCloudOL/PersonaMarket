import { Inject, Injectable } from '@nestjs/common';
import {
  IdSchema,
  type CreationSettingsUpdate,
  type SubmissionSettingsRecordsQuery,
} from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import type { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service.js';
import { CreationSettingsRepository } from './creation-settings.repository.js';
@Injectable()
export class CreationSettingsService {
  constructor(
    @Inject(AuthService) readonly auth: AuthService,
    @Inject(CreationSettingsRepository) readonly repository: CreationSettingsRepository,
  ) {}
  private async actor(request: Request, writing = false) {
    const actor = await this.auth.administrator(request, 'session');
    const expected = request.get('x-expected-account');
    if (
      expected !== undefined &&
      (!IdSchema.safeParse(expected).success || expected.toLowerCase() !== actor.account.id)
    )
      throw new BusinessError('CONFLICT', '登录账号已变化，请重新确认创作设置');
    await this.auth.rate.take(
      writing ? 'creation-settings-write' : 'creation-settings-read',
      actor.account.id,
      writing ? 30 : 120,
      60,
    );
    return actor;
  }
  async read(request: Request) {
    return this.repository.read(await this.actor(request));
  }
  async records(request: Request, input: SubmissionSettingsRecordsQuery) {
    return this.repository.records(await this.actor(request), input);
  }
  async update(request: Request, response: Response, input: CreationSettingsUpdate) {
    const actor = await this.actor(request, true);
    const value = request.get('idempotency-key');
    const parsed = value === undefined ? undefined : IdSchema.safeParse(value);
    if (parsed && !parsed.success)
      throw new BusinessError('INVALID_INPUT', '请提供有效的保存幂等标识');
    return this.repository.update(
      actor,
      input,
      parsed?.success ? parsed.data.toLowerCase() : undefined,
      this.auth.requestId(response),
    );
  }
}
