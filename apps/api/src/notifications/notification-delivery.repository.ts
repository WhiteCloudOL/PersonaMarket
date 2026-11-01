import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  idempotencyKeys,
  notifications,
  outboxEvents,
  processedEvents,
  users,
  type Database,
} from '@personamarket/database';
import {
  NotificationDeliveryDetailResponseSchema,
  NotificationRetryReceiptResponseSchema,
  type NotificationRetryReceiptQuery,
} from '@personamarket/contracts';
import { BusinessError, contentHash } from '@personamarket/server';
import type { Identity } from '../auth/auth.service.js';
import { lockIdentity, type Transaction } from '../auth/locked-identity.js';
import { administrationTransaction } from '../admin/administration-transaction.js';
import { DATABASE } from '../tokens.js';
import { notificationEventMatches, notificationRetryPolicy } from './notification-retry-policy.js';

@Injectable()
export class NotificationDeliveryRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}

  private read<T>(actor: Identity, operation: (tx: Transaction) => Promise<T>) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        return operation(tx);
      },
      { area: 'content', isolationLevel: 'repeatable read' },
    );
  }

  detail(actor: Identity, id: string) {
    return this.read(actor, async (tx) => {
      const [row] = await tx
        .select({
          id: notifications.id,
          recipient: { id: users.id, username: users.username },
          recipientStatus: users.status,
          kind: notifications.kind,
          revision: notifications.revision,
          eventId: notifications.eventId,
          status: notifications.status,
          attempts: notifications.attempts,
          createdAt: notifications.createdAt,
          lastAttemptedAt: notifications.lastAttemptedAt,
          completedAt: notifications.completedAt,
          deliveredAt: notifications.deliveredAt,
          errorCode: notifications.errorCode,
          currentEventProcessed: sql<boolean>`EXISTS (SELECT 1 FROM ${processedEvents} WHERE ${processedEvents.consumer}='notifications' AND ${processedEvents.eventId}=${notifications.eventId})`,
          event: {
            id: outboxEvents.id,
            topic: outboxEvents.topic,
            payload: outboxEvents.payload,
            attempts: outboxEvents.attempts,
            deliveredAt: outboxEvents.deliveredAt,
            leaseExpired: sql<boolean>`${outboxEvents.leaseUntil} IS NULL OR ${outboxEvents.leaseUntil}<=clock_timestamp()`,
          },
        })
        .from(notifications)
        .innerJoin(users, eq(users.id, notifications.recipientId))
        .leftJoin(outboxEvents, eq(outboxEvents.id, notifications.eventId))
        .where(eq(notifications.id, id))
        .limit(1);
      if (!row) throw new BusinessError('NOT_FOUND', '通知任务不存在或不可访问');
      const matched = notificationEventMatches(row, row.event);
      return NotificationDeliveryDetailResponseSchema.parse({
        data: {
          id: row.id,
          recipient: row.recipient,
          kind: row.kind,
          scope: row.kind === 'admin_notice' ? 'notice' : 'business',
          revision: row.revision,
          eventId: row.eventId,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
          dispatchAttempts: matched ? (row.event?.attempts ?? null) : null,
          // 分发耗尽恢复会将业务attempts写5；不能把它冒充五次消费执行
          executionAttempts:
            matched && row.event?.deliveredAt && row.lastAttemptedAt ? row.attempts : null,
          lastAttemptedAt: row.lastAttemptedAt?.toISOString() ?? null,
          completedAt: row.completedAt?.toISOString() ?? null,
          deliveredAt: row.deliveredAt?.toISOString() ?? null,
          errorCode: row.errorCode,
          currentEventProcessed: row.currentEventProcessed,
          ...notificationRetryPolicy(row),
          requiresRecentVerification: row.kind === 'account_security',
        },
        meta: { observedAt: new Date().toISOString() },
      });
    });
  }

  receipt(actor: Identity, id: string, input: NotificationRetryReceiptQuery, key: string) {
    return this.read(actor, async (tx) => {
      const [notification] = await tx
        .select({ id: notifications.id, kind: notifications.kind })
        .from(notifications)
        .where(eq(notifications.id, id));
      if (!notification) throw new BusinessError('NOT_FOUND', '通知任务不存在或不可访问');
      const operation =
        'notification.' + (notification.kind === 'admin_notice' ? 'notice' : 'business') + '.retry';
      const [previous] = await tx
        .select({
          requestHash: idempotencyKeys.requestHash,
          resultId: idempotencyKeys.resultId,
          createdAt: idempotencyKeys.createdAt,
        })
        .from(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.actorId, actor.account.id),
            eq(idempotencyKeys.operation, operation),
            eq(idempotencyKeys.key, key),
          ),
        );
      if (
        previous &&
        (previous.requestHash !== contentHash({ id, ...input, confirmed: true }) ||
          previous.resultId !== notification.id)
      )
        throw new BusinessError('CONFLICT', '原请求与该通知或修订不一致，请保留原操作核对');
      // 旧回执未记录旧轮次eventId，只证明原载荷曾被受理
      return NotificationRetryReceiptResponseSchema.parse({
        data: {
          notificationId: notification.id,
          recorded: Boolean(previous),
          recordedAt: previous?.createdAt.toISOString() ?? null,
        },
        meta: { observedAt: new Date().toISOString() },
      });
    });
  }
}
