import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  IdSchema,
  type AnnouncementWrite,
  type AnnouncementAction,
  type AnnouncementActionName,
  type AdminAnnouncementsQuery,
  type PublicAnnouncementsQuery,
  type AnnouncementRecordsQuery,
} from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import { AuthService } from '../auth/auth.service.js';
import { AnnouncementsRepository } from './announcements.repository.js';

@Injectable()
export class AnnouncementsService {
  constructor(
    @Inject(AuthService) readonly auth: AuthService,
    @Inject(AnnouncementsRepository) readonly repository: AnnouncementsRepository,
  ) {}
  private async actor(request: Request, writing = false) {
    const actor = await this.auth.administrator(request, 'session');
    const expected = request.get('x-expected-account');
    if (
      expected &&
      (!IdSchema.safeParse(expected).success || expected.toLowerCase() !== actor.account.id)
    )
      throw new BusinessError('CONFLICT', '登录账号已变化，请重新确认公告操作');
    await this.auth.rate.take(
      writing ? 'announcement-management-write' : 'announcement-management-read',
      actor.account.id,
      writing ? 30 : 120,
      60,
    );
    return actor;
  }
  private key(request: Request) {
    const value = IdSchema.safeParse(request.get('idempotency-key'));
    if (!value.success) throw new BusinessError('INVALID_INPUT', '请提供有效的操作幂等标识');
    return value.data.toLowerCase();
  }
  private expected(request: Request, id: string) {
    const raw = request.get('if-match');
    const prefix = '"announcement-' + id.toLowerCase() + '-';
    if (!raw?.startsWith(prefix) || !raw.endsWith('"'))
      throw new BusinessError('INVALID_INPUT', '请先读取公告，并提供对应的 If-Match 修订标识');
    const value = raw.slice(prefix.length, -1);
    if (!/^[1-9]\d{0,9}$/.test(value))
      throw new BusinessError('INVALID_INPUT', '公告修订标识无效，请重新读取');
    return Number(value);
  }
  async listPublic(request: Request, input: PublicAnnouncementsQuery) {
    await this.auth.rate.take('public-announcements', request.ip ?? 'unknown', 120, 60);
    return this.repository.listPublic(input);
  }
  async readPublic(request: Request, id: string) {
    await this.auth.rate.take('public-announcements', request.ip ?? 'unknown', 120, 60);
    return this.repository.readPublic(id.toLowerCase());
  }
  async sitemap(request: Request) {
    await this.auth.rate.take('public-announcements', request.ip ?? 'unknown', 120, 60);
    return this.repository.sitemap();
  }
  async list(request: Request, input: AdminAnnouncementsQuery) {
    return this.repository.list(await this.actor(request), input);
  }
  async detail(request: Request, id: string) {
    return this.repository.detail(await this.actor(request), id.toLowerCase());
  }
  async records(request: Request, id: string, input: AnnouncementRecordsQuery) {
    return this.repository.records(await this.actor(request), id.toLowerCase(), input);
  }
  async create(request: Request, response: Response, input: AnnouncementWrite) {
    return this.repository.change(
      await this.actor(request, true),
      { action: 'create', input },
      this.key(request),
      this.auth.requestId(response),
    );
  }
  async edit(request: Request, response: Response, id: string, input: AnnouncementWrite) {
    return this.repository.change(
      await this.actor(request, true),
      { action: 'edit', id: id.toLowerCase(), expected: this.expected(request, id), input },
      this.key(request),
      this.auth.requestId(response),
    );
  }
  async action(
    request: Request,
    response: Response,
    id: string,
    action: AnnouncementActionName,
    input: AnnouncementAction,
  ) {
    return this.repository.change(
      await this.actor(request, true),
      { action, id: id.toLowerCase(), expected: this.expected(request, id), input },
      this.key(request),
      this.auth.requestId(response),
    );
  }
}
