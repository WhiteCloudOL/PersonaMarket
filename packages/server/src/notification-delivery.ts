import { and, eq, sql } from 'drizzle-orm';
import {
  notifications,
  outboxEvents,
  processedEvents,
  users,
  type Database,
} from '@personamarket/database';
import { NotificationPayloadSchema, NotificationDeliveryJobSchema } from '@personamarket/contracts';
import type { z } from 'zod';
import { notificationTargetKey, resolveNotificationTargets } from './notification-targets.js';

export async function deliverNotification(
  database: Database,
  job: z.infer<typeof NotificationDeliveryJobSchema>,
  attempt: { number: number; last: boolean },
) {
  const data = NotificationDeliveryJobSchema.parse(job),
    attempts = Math.min(5, Math.max(1, attempt.number));
  try {
    return await database.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout='3s'`);
      const [done] = await tx
        .select({ id: processedEvents.eventId })
        .from(processedEvents)
        .where(
          and(
            eq(processedEvents.consumer, 'notifications'),
            eq(processedEvents.eventId, data.eventId),
          ),
        );
      if (done) return 'duplicate' as const;
      const [location] = await tx
        .select({ recipientId: notifications.recipientId })
        .from(notifications)
        .where(eq(notifications.id, data.notificationId));
      if (!location) throw new Error('NOTIFICATION_MISSING');
      // 与本人已读操作共用 user → notification 的锁顺序，避免反向锁死
      const [recipient] = await tx
        .select({ status: users.status })
        .from(users)
        .where(eq(users.id, location.recipientId))
        .for('update');
      const [row] = await tx
        .select()
        .from(notifications)
        .where(eq(notifications.id, data.notificationId))
        .for('update');
      const [event] = await tx
        .select({ topic: outboxEvents.topic, payload: outboxEvents.payload })
        .from(outboxEvents)
        .where(eq(outboxEvents.id, data.eventId));
      if (!row || !event || event.topic !== 'notification.deliver')
        throw new Error('NOTIFICATION_EVENT_MISMATCH');
      const reference = NotificationDeliveryJobSchema.omit({ eventId: true }).parse(event.payload);
      if (reference.notificationId !== row.id) throw new Error('NOTIFICATION_EVENT_MISMATCH');
      const acknowledge = () =>
        tx
          .insert(processedEvents)
          .values({ consumer: 'notifications', eventId: data.eventId })
          .onConflictDoNothing();
      if (row.eventId !== data.eventId || row.status !== 'queued') {
        await acknowledge();
        return 'duplicate' as const;
      }
      const payload = NotificationPayloadSchema.parse({
        recipientId: row.recipientId,
        actorId: row.actorId,
        sourceId: row.sourceId,
        kind: row.kind,
        title: row.title,
        message: row.message,
        target: row.target,
      });
      const destinations =
        recipient?.status === 'active'
          ? await resolveNotificationTargets(tx, row.recipientId, [payload.target], {
              paths: false,
            })
          : undefined;
      const available =
        destinations?.get(notificationTargetKey(payload.target))?.available ?? false;
      await tx
        .update(notifications)
        .set({
          status: available ? 'delivered' : 'skipped',
          attempts,
          lastAttemptedAt: sql`clock_timestamp()`,
          completedAt: sql`clock_timestamp()`,
          deliveredAt: available ? sql`clock_timestamp()` : null,
          errorCode: available ? null : 'TARGET_UNAVAILABLE',
        })
        .where(eq(notifications.id, row.id));
      await acknowledge();
      return available ? ('delivered' as const) : ('skipped' as const);
    });
  } catch (cause) {
    try {
      await database.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout='3s'`);
        await tx
          .update(notifications)
          .set({
            attempts,
            lastAttemptedAt: sql`clock_timestamp()`,
            errorCode: 'DELIVERY_FAILED',
            ...(attempt.last
              ? { status: 'failed' as const, completedAt: sql`clock_timestamp()` }
              : {}),
          })
          .where(
            and(
              eq(notifications.id, data.notificationId),
              eq(notifications.eventId, data.eventId),
              eq(notifications.status, 'queued'),
            ),
          );
      });
    } catch {
      /* 数据库完全不可用时由BullMQ保留失败和重试，不能把任务伪装为已送达 */
    }
    throw new Error('NOTIFICATION_DELIVERY_FAILED', { cause });
  }
}
