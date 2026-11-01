import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { notifications, outboxEvents, type Database } from '@personamarket/database';
import {
  NotificationPayloadSchema,
  NotificationDeliveryJobSchema,
  type NotificationPayload,
} from '@personamarket/contracts';

type Transaction = Parameters<Parameters<Database['db']['transaction']>[0]>[0];
/** 消息和Outbox同事务保存，队列只携带标识，未投递的消息不进入收件箱 */
export async function enqueueNotification(tx: Transaction, input: NotificationPayload) {
  const payload = NotificationPayloadSchema.parse(input),
    id = randomUUID(),
    eventId = randomUUID();
  await tx.insert(outboxEvents).values({
    id: eventId,
    topic: 'notification.deliver',
    payload: NotificationDeliveryJobSchema.omit({ eventId: true }).parse({
      schemaVersion: 1,
      notificationId: id,
    }),
  });
  const [inserted] = await tx
    .insert(notifications)
    .values({ ...payload, id, eventId })
    .onConflictDoNothing({
      target: [notifications.recipientId, notifications.kind, notifications.sourceId],
    })
    .returning({ id: notifications.id });
  if (inserted) return inserted.id;
  // 仅撤销本事务内新建且无人引用的Outbox，不删除任何已提交投递记录
  await tx.delete(outboxEvents).where(eq(outboxEvents.id, eventId));
  const [existing] = await tx
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientId, payload.recipientId),
        eq(notifications.kind, payload.kind),
        eq(notifications.sourceId, payload.sourceId),
      ),
    )
    .limit(1);
  if (!existing) throw new Error('NOTIFICATION_DEDUPLICATION_FAILED');
  return existing.id;
}
