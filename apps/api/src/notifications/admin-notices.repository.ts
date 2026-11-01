import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import {
  notifications,
  outboxEvents,
  authAuditEvents,
  users,
  type Database,
} from '@personamarket/database';
import {
  AdminNoticeResponseSchema,
  AdminNoticesResponseSchema,
  NotificationRecipientResponseSchema,
  type AdminNoticesQuery,
  type CreateAdminNotice,
  type RetryAdminNoticeSchema,
} from '@personamarket/contracts';
import type { z } from 'zod';
import { BusinessError, enqueueNotification } from '@personamarket/server';
import { retryNotification } from './notification-retry.js';
import { DATABASE } from '../tokens.js';
import type { Identity } from '../auth/auth.service.js';
import { lockIdentity, type Transaction } from '../auth/locked-identity.js';
import { administrationTransaction } from '../admin/administration-transaction.js';
import { idempotentResult, rememberResult } from '../releases/release-helpers.js';
import {
  effectiveNoticeStatus,
  noticeActor,
  noticeFields,
  noticeView,
  readNotice,
} from './notice-views.js';

@Injectable()
export class AdminNoticesRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}
  private transaction<T>(
    actor: Identity,
    write: boolean,
    operation: (tx: Transaction) => Promise<T>,
  ) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        return operation(tx);
      },
      { area: 'content', serializeWrites: write },
    );
  }
  recipient(actor: Identity, username: string) {
    return this.transaction(actor, false, async (tx) => {
      const [row] = await tx
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(and(eq(users.status, 'active'), sql`lower(${users.username})=lower(${username})`))
        .limit(1);
      if (!row) throw new BusinessError('NOT_FOUND', '收件账号不存在或暂不可接收通知');
      return NotificationRecipientResponseSchema.parse({ data: row });
    });
  }
  detail(actor: Identity, id: string) {
    return this.transaction(actor, false, async (tx) =>
      AdminNoticeResponseSchema.parse({ data: await readNotice(tx, id) }),
    );
  }
  list(actor: Identity, input: AdminNoticesQuery) {
    return this.transaction(actor, false, async (tx) => {
      const condition = and(
        eq(notifications.kind, 'admin_notice'),
        input.status === 'all' ? undefined : sql`${effectiveNoticeStatus}=${input.status}`,
        input.recipientId ? eq(notifications.recipientId, input.recipientId) : undefined,
      );
      const rows = await tx
        .select(noticeFields)
        .from(notifications)
        .innerJoin(users, eq(users.id, notifications.recipientId))
        .innerJoin(noticeActor, eq(noticeActor.id, notifications.actorId))
        .innerJoin(outboxEvents, eq(outboxEvents.id, notifications.eventId))
        .where(condition)
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(20)
        .offset((input.page - 1) * 20);
      const [total] = await tx
        .select({ amount: count() })
        .from(notifications)
        .innerJoin(outboxEvents, eq(outboxEvents.id, notifications.eventId))
        .where(condition);
      return AdminNoticesResponseSchema.parse({
        data: rows.map(noticeView),
        meta: { page: input.page, pageSize: 20, total: total?.amount ?? 0 },
      });
    });
  }
  create(actor: Identity, input: CreateAdminNotice, key: string, requestId: string) {
    return this.transaction(actor, true, async (tx) => {
      const retry = await idempotentResult(tx, actor, 'notification.notice.create', key, input);
      if (retry) return AdminNoticeResponseSchema.parse({ data: await readNotice(tx, retry) });
      const [recipient] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, input.recipientId), eq(users.status, 'active')));
      if (!recipient) throw new BusinessError('NOT_FOUND', '收件账号不存在或暂不可接收通知');
      const [quota] = await tx
        .select({ amount: count() })
        .from(notifications)
        .where(
          and(
            eq(notifications.kind, 'admin_notice'),
            eq(notifications.actorId, actor.account.id),
            sql`${notifications.createdAt}>=(date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`,
          ),
        );
      if ((quota?.amount ?? 0) >= 100)
        throw new BusinessError('RATE_LIMITED', '本日管理员通知数量已达上限，请稍后再试');
      const id = await enqueueNotification(tx, {
        recipientId: recipient.id,
        actorId: actor.account.id,
        sourceId: randomUUID(),
        kind: 'admin_notice',
        title: input.title,
        message: input.message,
        target: { type: 'none' },
      });
      await tx
        .insert(authAuditEvents)
        .values({ userId: actor.account.id, event: 'admin.notification_created', requestId });
      await rememberResult(tx, actor, 'notification.notice.create', key, input, id);
      return AdminNoticeResponseSchema.parse({ data: await readNotice(tx, id) });
    });
  }
  retry(
    actor: Identity,
    id: string,
    input: z.infer<typeof RetryAdminNoticeSchema>,
    key: string,
    requestId: string,
  ) {
    return this.transaction(actor, true, async (tx) => {
      const result = await retryNotification(tx, actor, id, input, key, requestId, 'notice');
      return AdminNoticeResponseSchema.parse({ data: await readNotice(tx, result) });
    });
  }
}
