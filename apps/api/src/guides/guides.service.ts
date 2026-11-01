import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  IdSchema,
  type GuideSlug,
  type GuideWrite,
  type GuideAction,
  type GuideActionName,
  type AdminGuidesQuery,
  type GuideRecordsQuery,
} from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import { AuthService } from '../auth/auth.service.js';
import { GuidesRepository } from './guides.repository.js';

@Injectable()
export class GuidesService {
  constructor(
    @Inject(AuthService) readonly auth: AuthService,
    @Inject(GuidesRepository) readonly repository: GuidesRepository,
  ) {}
  private async actor(request: Request, writing = false) {
    const actor = await this.auth.administrator(request, 'session');
    const expected = request.get('x-expected-account');
    if (
      expected &&
      (!IdSchema.safeParse(expected).success || expected.toLowerCase() !== actor.account.id)
    )
      throw new BusinessError('CONFLICT', '登录账号已变化，请重新确认指南内容');
    await this.auth.rate.take(
      writing ? 'guide-management-write' : 'guide-management-read',
      actor.account.id,
      writing ? 30 : 120,
      60,
    );
    return actor;
  }
  private async publicActor(request: Request) {
    await this.auth.rate.take('site-guides', request.ip ?? 'unknown', 120, 60);
  }
  async publicList(request: Request) {
    await this.publicActor(request);
    return this.repository.publicList();
  }
  async publicDetail(request: Request, slug: GuideSlug) {
    await this.publicActor(request);
    return this.repository.publicDetail(slug);
  }
  async sitemap(request: Request) {
    await this.publicActor(request);
    return this.repository.sitemap();
  }
  async list(request: Request, input: AdminGuidesQuery) {
    return this.repository.list(await this.actor(request), input);
  }
  async read(request: Request, slug: GuideSlug) {
    return this.repository.read(await this.actor(request), slug);
  }
  async records(request: Request, slug: GuideSlug, input: GuideRecordsQuery) {
    return this.repository.records(await this.actor(request), slug, input);
  }
  private headers(request: Request, slug: GuideSlug) {
    const match = new RegExp('^"guide-' + slug + '-([1-9]\\d{0,9})"$').exec(
      request.get('if-match') ?? '',
    );
    if (!match?.[1]) throw new BusinessError('INVALID_INPUT', '请先读取指南并提供对应的 If-Match');
    const key = IdSchema.safeParse(request.get('idempotency-key'));
    if (!key.success) throw new BusinessError('INVALID_INPUT', '请提供有效的操作幂等标识');
    return { expected: Number(match[1]), key: key.data.toLowerCase() };
  }
  async update(request: Request, response: Response, slug: GuideSlug, input: GuideWrite) {
    const actor = await this.actor(request, true),
      headers = this.headers(request, slug);
    return this.repository.mutate(
      actor,
      { action: 'edit', slug, input, expected: headers.expected },
      headers.key,
      this.auth.requestId(response),
    );
  }
  async action(
    request: Request,
    response: Response,
    slug: GuideSlug,
    action: GuideActionName,
    input: GuideAction,
  ) {
    const actor = await this.actor(request, true),
      headers = this.headers(request, slug);
    return this.repository.mutate(
      actor,
      { action, slug, input, expected: headers.expected },
      headers.key,
      this.auth.requestId(response),
    );
  }
}
