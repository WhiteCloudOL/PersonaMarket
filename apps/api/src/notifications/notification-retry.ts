import { randomUUID } from 'node:crypto';
import { and, eq, ne, sql } from 'drizzle-orm';
import {
  notifications,
  outboxEvents,
  processedEvents,
  users,
  authAuditEvents,
} from '@personamarket/database';
import { BusinessError } from '@personamarket/server';
import type { RetryAdminNoticeSchema } from '@personamarket/contracts';
import type { z } from 'zod';
import type { Transaction } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import { lockIdentity } from '../auth/locked-identity.js';
import { idempotentResult, rememberResult } from '../releases/release-helpers.js';
import { notificationRetryPolicy } from './notification-retry-policy.js';

export async function retryNotification(
  tx: Transaction,
  actor: Identity,
  id: string,
  input: z.infer<typeof RetryAdminNoticeSchema>,
  key: string,
  requestId: string,
  scope: 'notice' | 'business',
) {
  const operation = 'notification.' + scope + '.retry',
    command = { id, ...input };
  const [row] = await tx
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.id, id),
        scope === 'notice'
          ? eq(notifications.kind, 'admin_notice')
          : ne(notifications.kind, 'admin_notice'),
      ),
    )
    .for('update');
  if (!row) throw new BusinessError('NOT_FOUND', '通知任务不存在或不可访问');
  // 敏感安全任务在幂等重放前按实际MFA状态核验近期身份
  if (row.kind === 'account_security') await lockIdentity(tx, actor, true, true);
  const previous = await idempotentResult(tx, actor, operation, key, command);
  if (previous) return previous;
  if (row.revision !== input.expectedRevision)
    throw new BusinessError('REVISION_CONFLICT', '通知投递状态已更新，请核对后重试');
  const [outbox] = await tx
    .select({
      id: outboxEvents.id,
      topic: outboxEvents.topic,
      payload: outboxEvents.payload,
      attempts: outboxEvents.attempts,
      deliveredAt: outboxEvents.deliveredAt,
      leaseExpired: sql<boolean>`${outboxEvents.leaseUntil} IS NULL OR ${outboxEvents.leaseUntil}<=clock_timestamp()`,
    })
    .from(outboxEvents)
    .where(eq(outboxEvents.id, row.eventId))
    .for('update');
  const [receipt] = await tx
    .select({ eventId: processedEvents.eventId })
    .from(processedEvents)
    .where(
      and(eq(processedEvents.consumer, 'notifications'), eq(processedEvents.eventId, row.eventId)),
    );
  const [recipient] = await tx
    .select({ status: users.status })
    .from(users)
    .where(eq(users.id, row.recipientId));
  const policy = notificationRetryPolicy({
    id: row.id,
    eventId: row.eventId,
    status: row.status,
    recipientStatus: recipient?.status ?? 'unknown',
    currentEventProcessed: Boolean(receipt),
    event: outbox ?? null,
  });
  if (!policy.retryAllowed) {
    const message =
      policy.retryBlockedReason === 'STATE_UNVERIFIABLE'
        ? '当前通知事件或投递结果无法核验，请保留原任务核对'
        : policy.retryBlockedReason === 'RECIPIENT_UNAVAILABLE'
          ? '收件账号暂不可接收通知，请核对账号状态'
          : '只有已失败的通知可以重试，请先核对投递状态';
    throw new BusinessError('CONFLICT', message);
  }
  // 0034约束仅允许failed重投；严格确认派发耗尽后在同事务先记失败，原始GET仍保留queued
  if (row.status === 'queued')
    await tx
      .update(notifications)
      .set({
        status: 'failed',
        attempts: 5,
        errorCode: 'DELIVERY_FAILED',
        lastAttemptedAt: sql`clock_timestamp()`,
        completedAt: sql`clock_timestamp()`,
      })
      .where(eq(notifications.id, id));
  const eventId = randomUUID();
  await tx.insert(outboxEvents).values({
    id: eventId,
    topic: 'notification.deliver',
    payload: { schemaVersion: 1, notificationId: id },
  });
  await tx
    .update(notifications)
    .set({
      eventId,
      revision: row.revision + 1,
      status: 'queued',
      attempts: 0,
      errorCode: null,
      lastAttemptedAt: null,
      completedAt: null,
      deliveredAt: null,
    })
    .where(eq(notifications.id, id));
  await tx
    .insert(authAuditEvents)
    .values({ userId: actor.account.id, event: 'admin.notification_retried', requestId });
  await rememberResult(tx, actor, operation, key, command, id);
  return id;
}
