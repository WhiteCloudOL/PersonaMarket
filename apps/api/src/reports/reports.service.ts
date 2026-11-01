import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  IdSchema,
  type CreateReport,
  type OwnReportsQuery,
  type AdminReportsQuery,
  type ReportRecordsQuery,
  type AdminReportAction,
} from '@personamarket/contracts';
import { BusinessError, LocalStorage, type ServerEnvironment } from '@personamarket/server';
import { ENVIRONMENT } from '../tokens.js';
import { AuthService } from '../auth/auth.service.js';
import { ReportsRepository } from './reports.repository.js';

@Injectable()
export class ReportsService {
  private readonly storage;
  constructor(
    @Inject(ENVIRONMENT) env: ServerEnvironment,
    @Inject(AuthService) readonly auth: AuthService,
    @Inject(ReportsRepository) readonly repository: ReportsRepository,
  ) {
    this.storage = new LocalStorage(env.STORAGE_ROOT);
  }
  async avatar(request: Request, response: Response, id: string, admin: boolean) {
    const key = await this.repository.avatar(
      await this.actor(request, admin),
      id.toLowerCase(),
      admin,
    );
    const bytes = await this.storage.read(key).catch(() => {
      throw new BusinessError('NOT_FOUND', '头像证据暂时无法读取');
    });
    response.setHeader('Content-Type', 'image/webp');
    response.setHeader('Content-Disposition', 'inline');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(Buffer.from(bytes));
  }
  private async actor(request: Request, admin = false, writing = false) {
    const actor = admin
      ? await this.auth.administrator(request, 'session')
      : await this.auth.identity(request);
    const expected = request.get('x-expected-account');
    if (
      expected &&
      (!IdSchema.safeParse(expected).success || expected.toLowerCase() !== actor.account.id)
    )
      throw new BusinessError('CONFLICT', '登录账号已变化，请重新确认举报内容');
    await this.auth.rate.take(
      writing ? (admin ? 'report-manage' : 'report-create') : 'reports-read',
      actor.account.id,
      writing ? (admin ? 30 : 3) : 120,
      60,
    );
    return actor;
  }
  private key(request: Request) {
    const parsed = IdSchema.safeParse(request.get('idempotency-key'));
    if (!parsed.success) throw new BusinessError('INVALID_INPUT', '请提供有效的操作幂等标识');
    return parsed.data.toLowerCase();
  }
  ownList(request: Request, input: OwnReportsQuery) {
    return this.actor(request).then((actor) => this.repository.ownList(actor, input));
  }
  own(request: Request, id: string) {
    return this.actor(request).then((actor) => this.repository.own(actor, id.toLowerCase()));
  }
  ownRecords(request: Request, id: string, input: ReportRecordsQuery) {
    return this.actor(request).then((actor) =>
      this.repository.records(actor, id.toLowerCase(), input, false),
    );
  }
  adminList(request: Request, input: AdminReportsQuery) {
    return this.actor(request, true).then((actor) => this.repository.adminList(actor, input));
  }
  admin(request: Request, id: string) {
    return this.actor(request, true).then((actor) =>
      this.repository.admin(actor, id.toLowerCase()),
    );
  }
  adminRecords(request: Request, id: string, input: ReportRecordsQuery) {
    return this.actor(request, true).then((actor) =>
      this.repository.records(actor, id.toLowerCase(), input, true),
    );
  }
  async create(request: Request, response: Response, input: CreateReport) {
    const actor = await this.actor(request, false, true);
    return this.repository.create(actor, input, this.key(request), this.auth.requestId(response));
  }
  async act(request: Request, response: Response, rawId: string, input: AdminReportAction) {
    const actor = await this.actor(request, true, true),
      id = rawId.toLowerCase();
    const match = new RegExp('^"report-' + id + '-([1-9]\\d{0,9})"$').exec(
      request.get('if-match') ?? '',
    );
    if (!match?.[1]) throw new BusinessError('INVALID_INPUT', '请先读取举报并提供对应的 If-Match');
    return this.repository.act(
      actor,
      id,
      Number(match[1]),
      input,
      this.key(request),
      this.auth.requestId(response),
    );
  }
}
