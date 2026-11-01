import { and, eq, sql } from 'drizzle-orm';
import { notifications, outboxEvents, type Database } from '@personamarket/database';
import { NotificationDeliveryJobSchema } from '@personamarket/contracts';
import type { createSystemQueue } from './outbox.js';

/** 数据库故障可能同时阻止消费和失败落库；恢复后以当前事件的真实队列终态补记 */
export async function reconcileNotificationFailures(
  database: Database,
  queue: Pick<ReturnType<typeof createSystemQueue>, 'getJob'>,
) {
  const candidates = await database.db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout='3s'`);
    await tx.execute(sql`WITH exhausted AS MATERIALIZED (
      SELECT n.id,n.event_id FROM notifications n JOIN outbox_events o ON o.id=n.event_id
      WHERE n.status='queued' AND o.delivered_at IS NULL AND o.attempts>=5
        AND (o.lease_until IS NULL OR o.lease_until<=clock_timestamp())
      ORDER BY n.created_at,n.id LIMIT 20 FOR UPDATE OF n SKIP LOCKED
    ) UPDATE notifications n SET status='failed',attempts=5,error_code='DELIVERY_FAILED',last_attempted_at=clock_timestamp(),completed_at=clock_timestamp()
      FROM exhausted e WHERE n.id=e.id AND n.event_id=e.event_id AND n.status='queued'`);
    return tx
      .select({ id: notifications.id, eventId: notifications.eventId })
      .from(notifications)
      .innerJoin(outboxEvents, eq(outboxEvents.id, notifications.eventId))
      .where(and(eq(notifications.status, 'queued'), sql`${outboxEvents.deliveredAt} IS NOT NULL`))
      .orderBy(notifications.createdAt, notifications.id)
      .limit(20);
  });
  for (const row of candidates) {
    const job = await queue.getJob(row.eventId);
    if (
      !job ||
      job.name !== 'notification.deliver' ||
      job.attemptsMade < (job.opts.attempts ?? 5) ||
      (await job.getState()) !== 'failed'
    )
      continue;
    const parsed = NotificationDeliveryJobSchema.safeParse(job.data);
    if (
      !parsed.success ||
      parsed.data.eventId !== row.eventId ||
      parsed.data.notificationId !== row.id
    )
      continue;
    await database.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout='3s'`);
      await tx
        .update(notifications)
        .set({
          status: 'failed',
          attempts: Math.min(5, job.attemptsMade),
          errorCode: 'DELIVERY_FAILED',
          lastAttemptedAt: sql`clock_timestamp()`,
          completedAt: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(notifications.id, row.id),
            eq(notifications.eventId, row.eventId),
            eq(notifications.status, 'queued'),
          ),
        );
    });
  }
}
