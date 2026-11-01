import { Inject, Injectable } from '@nestjs/common';
import {
  IdSchema,
  PublicSystemStatusResponseSchema,
  type SystemSettingsWrite,
  type SystemSettingsRecordsQuery,
} from '@personamarket/contracts';
import { BusinessError, readSystemSettings } from '@personamarket/server';
import type { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service.js';
import { readApiBuildInfo } from '../build-info.js';
import { SystemSettingsRepository } from './system-settings.repository.js';

@Injectable()
export class SystemSettingsService {
  constructor(
    @Inject(AuthService) readonly auth: AuthService,
    @Inject(SystemSettingsRepository) readonly repository: SystemSettingsRepository,
  ) {}
  private async actor(request: Request, writing = false) {
    const actor = await this.auth.administrator(request, 'session'),
      expected = request.get('x-expected-account');
    if (
      expected !== undefined &&
      (!IdSchema.safeParse(expected).success || expected.toLowerCase() !== actor.account.id)
    )
      throw new BusinessError('CONFLICT', '登录账号已变化，请重新核对维护设置');
    await this.auth.rate.take(
      writing ? 'system-settings-write' : 'system-settings-read',
      actor.account.id,
      writing ? 30 : 120,
      60,
    );
    return actor;
  }
  async publicStatus(request: Request) {
    await this.auth.rate.take('system-public-status', request.ip ?? 'unknown', 120, 60);
    const current = await readSystemSettings(this.repository.database);
    return PublicSystemStatusResponseSchema.parse({ data: current.data, meta: current.meta });
  }
  async read(request: Request) {
    return this.repository.read(await this.actor(request));
  }
  async records(request: Request, input: SystemSettingsRecordsQuery) {
    return this.repository.records(await this.actor(request), input);
  }
  async runtime(request: Request) {
    const actor = await this.actor(request);
    await this.repository.authorize(actor);
    const result = await readApiBuildInfo();
    await this.repository.authorize(actor);
    return result;
  }
  async update(request: Request, response: Response, input: SystemSettingsWrite) {
    const actor = await this.actor(request, true);
    const match = /^"system-([1-9]\d{0,9})"$/u.exec(request.get('if-match') ?? '');
    if (!match?.[1])
      throw new BusinessError('REVISION_CONFLICT', '请读取维护设置并提供有效If-Match');
    const key = IdSchema.safeParse(request.get('idempotency-key'));
    if (!key.success) throw new BusinessError('INVALID_INPUT', '请提供有效的保存幂等标识');
    const expected = Number(match[1]),
      normalizedKey = key.data.toLowerCase();
    const replay = await this.repository.replay(actor, input, expected, normalizedKey);
    if (replay) return replay;
    this.auth.requireRecentVerification(actor);
    return this.repository.update(
      actor,
      input,
      expected,
      normalizedKey,
      this.auth.requestId(response),
    );
  }
}
