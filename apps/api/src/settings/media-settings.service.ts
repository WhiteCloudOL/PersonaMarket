import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  IdSchema,
  type MediaSettingsWrite,
  type MediaSettingsRecordsQuery,
} from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import { AuthService } from '../auth/auth.service.js';
import { MediaSettingsRepository } from './media-settings.repository.js';

@Injectable()
export class MediaSettingsService {
  constructor(
    @Inject(AuthService) readonly auth: AuthService,
    @Inject(MediaSettingsRepository) readonly repository: MediaSettingsRepository,
  ) {}
  private async actor(request: Request, writing = false) {
    const actor = await this.auth.administrator(request, 'session');
    const expected = request.get('x-expected-account');
    if (
      expected &&
      (!IdSchema.safeParse(expected).success || expected.toLowerCase() !== actor.account.id)
    )
      throw new BusinessError('CONFLICT', '登录账号已变化，请重新确认文件与图片设置');
    await this.auth.rate.take(
      writing ? 'media-settings-write' : 'media-settings-read',
      actor.account.id,
      writing ? 30 : 120,
      60,
    );
    return actor;
  }
  async publicRead(request: Request) {
    await this.auth.rate.take('site-media-settings', request.ip ?? 'unknown', 120, 60);
    return this.repository.publicRead();
  }
  async read(request: Request) {
    return this.repository.read(await this.actor(request));
  }
  async records(request: Request, input: MediaSettingsRecordsQuery) {
    return this.repository.records(await this.actor(request), input);
  }
  async update(request: Request, response: Response, input: MediaSettingsWrite) {
    const actor = await this.actor(request, true);
    const match = /^"media-([1-9]\d{0,9})"$/.exec(request.get('if-match') ?? '');
    if (!match?.[1])
      throw new BusinessError('INVALID_INPUT', '请先读取文件与图片设置并提供对应的 If-Match');
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
