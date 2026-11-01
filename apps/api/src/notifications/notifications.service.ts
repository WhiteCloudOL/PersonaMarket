import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  IdSchema,
  type NotificationsQuery,
  type AdminNoticesQuery,
  type CreateAdminNotice,
  type RetryAdminNoticeSchema,
  type NotificationFailuresQuery,
  type UpdateNotificationPreferences,
  type NotificationRetryReceiptQuery,
} from '@personamarket/contracts';
import type { z } from 'zod';
import { BusinessError } from '@personamarket/server';
import { AuthService } from '../auth/auth.service.js';
import { NotificationsRepository } from './notifications.repository.js';
import { AdminNoticesRepository } from './admin-notices.repository.js';
import { NotificationFailuresRepository } from './notification-failures.repository.js';
import { NotificationDeliveryRepository } from './notification-delivery.repository.js';

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(AuthService) readonly auth: AuthService,
    @Inject(NotificationsRepository) readonly inbox: NotificationsRepository,
    @Inject(AdminNoticesRepository) readonly notices: AdminNoticesRepository,
    @Inject(NotificationFailuresRepository) readonly failed: NotificationFailuresRepository,
    @Inject(NotificationDeliveryRepository) readonly delivery: NotificationDeliveryRepository,
  ) {}
  private async actor(request: Request, admin = false, write = false) {
    const actor = admin
      ? await this.auth.administrator(request, 'session')
      : await this.auth.identity(request);
    const expected = request.get('x-expected-account');
    if (
      expected &&
      (!IdSchema.safeParse(expected).success || expected.toLowerCase() !== actor.account.id)
    )
      throw new BusinessError('CONFLICT', '登录账号已变化，请重新核对通知操作');
    await this.auth.rate.take(
      write ? (admin ? 'admin-notice-write' : 'notification-read-state') : 'notification-read',
      actor.account.id,
      write && admin ? 10 : 120,
      60,
    );
    return actor;
  }
  private key(request: Request) {
    const key = IdSchema.safeParse(request.get('idempotency-key'));
    if (!key.success) throw new BusinessError('INVALID_INPUT', '请提供有效的操作幂等标识');
    return key.data.toLowerCase();
  }
  list(request: Request, input: NotificationsQuery) {
    return this.actor(request).then((actor) => this.inbox.list(actor, input));
  }
  counts(request: Request) {
    return this.actor(request).then((actor) => this.inbox.counts(actor));
  }
  preferences(request: Request) {
    return this.actor(request).then((actor) => this.inbox.preferences(actor));
  }
  async updatePreferences(
    request: Request,
    response: Response,
    input: UpdateNotificationPreferences,
  ) {
    return this.inbox.updatePreferences(
      await this.actor(request, false, true),
      input,
      this.auth.requestId(response),
    );
  }
  readOne(request: Request, id: string) {
    return this.actor(request, false, true).then((actor) =>
      this.inbox.readOne(actor, id.toLowerCase()),
    );
  }
  readAll(request: Request, throughId: string) {
    return this.actor(request, false, true).then((actor) =>
      this.inbox.readAll(actor, throughId.toLowerCase()),
    );
  }
  recipient(request: Request, username: string) {
    return this.actor(request, true).then((actor) => this.notices.recipient(actor, username));
  }
  adminList(request: Request, input: AdminNoticesQuery) {
    return this.actor(request, true).then((actor) => this.notices.list(actor, input));
  }
  failures(request: Request, input: NotificationFailuresQuery) {
    return this.actor(request, true).then((actor) => this.failed.list(actor, input));
  }
  deliveryDetail(request: Request, id: string) {
    return this.actor(request, true).then((actor) => this.delivery.detail(actor, id.toLowerCase()));
  }
  async retryReceipt(request: Request, id: string, input: NotificationRetryReceiptQuery) {
    const actor = await this.actor(request, true);
    return this.delivery.receipt(actor, id.toLowerCase(), input, this.key(request));
  }
  async retryFailure(
    request: Request,
    response: Response,
    id: string,
    input: z.infer<typeof RetryAdminNoticeSchema>,
  ) {
    const actor = await this.actor(request, true, true);
    return this.failed.retry(
      actor,
      id.toLowerCase(),
      input,
      this.key(request),
      this.auth.requestId(response),
    );
  }
  adminDetail(request: Request, id: string) {
    return this.actor(request, true).then((actor) => this.notices.detail(actor, id.toLowerCase()));
  }
  async create(request: Request, response: Response, input: CreateAdminNotice) {
    const actor = await this.actor(request, true, true);
    return this.notices.create(actor, input, this.key(request), this.auth.requestId(response));
  }
  async retry(
    request: Request,
    response: Response,
    id: string,
    input: z.infer<typeof RetryAdminNoticeSchema>,
  ) {
    const actor = await this.actor(request, true, true);
    return this.notices.retry(
      actor,
      id.toLowerCase(),
      input,
      this.key(request),
      this.auth.requestId(response),
    );
  }
}
