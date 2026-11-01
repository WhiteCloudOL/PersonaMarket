import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { notifications } from '@personamarket/database';
import { NotificationDeliveryJobSchema, type NotificationPayload } from '@personamarket/contracts';
import { createSystemQueue, deliverNotification, enqueueNotification } from '@personamarket/server';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator } from '../fixtures/creator.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
function fixtureQueue() {
  if (!stack.worker.name.startsWith('auth-case-')) throw new Error('通知重投只能使用夹具专属队列');
  return createSystemQueue(stack.env.REDIS_URL, stack.worker.name);
}
beforeEach(async () => {
  stack = await createAuthStack();
  expect(stack.env.QUEUE_NAME).toBe(stack.worker.name);
});
afterEach(async () => {
  await stack?.close();
});
async function input(): Promise<NotificationPayload> {
  const user = await verifiedCreator(stack);
  const row = (
    await stack.owner.pool.query<{ id: string }>('SELECT id FROM users WHERE username=$1', [
      user.username,
    ])
  ).rows[0];
  if (!row) throw new Error('缺少隔离通知收件人');
  return {
    recipientId: row.id,
    actorId: null,
    sourceId: randomUUID(),
    kind: 'account_security',
    title: '账号安全设置已更新',
    message: '请在账号与安全核对最新状态',
    target: { type: 'account' },
  };
}
async function read(id: string) {
  const [row] = await stack.owner.db.select().from(notifications).where(eq(notifications.id, id));
  if (!row) throw new Error('缺少真实通知');
  return row;
}
it('业务回滚不留下通知或Outbox，同一业务事件去重，真实队列重投不会重复投递', async () => {
  const payload = await input();
  const id = await stack.owner.db.transaction((tx) => enqueueNotification(tx, payload));
  const duplicate = await stack.owner.db.transaction((tx) => enqueueNotification(tx, payload));
  expect(duplicate).toBe(id);
  expect((await read(id)).status).toBe('queued');
  expect(
    (
      await stack.owner.pool.query(
        "SELECT count(*)::integer AS amount FROM outbox_events WHERE topic='notification.deliver'",
      )
    ).rows[0]?.amount,
  ).toBe(1);
  const rolledBack = { ...payload, sourceId: randomUUID() };
  await expect(
    stack.owner.db.transaction(async (tx) => {
      await enqueueNotification(tx, rolledBack);
      throw new Error('ROLL_BACK_NOTIFICATION_FIXTURE');
    }),
  ).rejects.toThrow('ROLL_BACK_NOTIFICATION_FIXTURE');
  expect(
    await stack.owner.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.sourceId, rolledBack.sourceId)),
  ).toEqual([]);
  await stack.tick();
  await expect.poll(async () => (await read(id)).status).toBe('delivered');
  const row = await read(id),
    queue = fixtureQueue();
  try {
    const original = await queue.getJob(row.eventId);
    expect(original).toBeDefined();
    const jobData = NotificationDeliveryJobSchema.parse(original?.data);
    expect(Object.keys(jobData).sort()).toEqual(['eventId', 'notificationId', 'schemaVersion']);
    const replay = await queue.add('notification.deliver', jobData, {
      jobId: randomUUID(),
      attempts: 1,
      removeOnFail: false,
    });
    await expect.poll(() => replay.getState()).toBe('completed');
    expect(
      (
        await stack.owner.pool.query(
          'SELECT count(*)::integer AS amount FROM processed_events WHERE consumer=$1 AND event_id=$2',
          ['notifications', row.eventId],
        )
      ).rows[0]?.amount,
    ).toBe(1);
    expect((await read(id)).deliveredAt).toEqual(row.deliveredAt);
    await expect(
      stack.owner.pool.query("UPDATE notifications SET title='篡改消息' WHERE id=$1", [id]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      stack.owner.pool.query('DELETE FROM notifications WHERE id=$1', [id]),
    ).rejects.toMatchObject({ code: '23514' });
  } finally {
    await queue.close();
  }
});
it('消费者写入和processed_events原子提交，真实数据库失败有限重试后可见且不误报送达', async () => {
  const payload = await input();
  const id = await stack.owner.db.transaction((tx) => enqueueNotification(tx, payload)),
    row = await read(id);
  const queue = fixtureQueue();
  try {
    await stack.owner.pool.query(
      `CREATE FUNCTION reject_notification_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.consumer='notifications' THEN RAISE EXCEPTION 'CONTROLLED_NOTIFICATION_RECEIPT_FAILURE' USING ERRCODE='23514'; END IF; RETURN NEW; END; $$`,
    );
    await stack.owner.pool.query(
      'CREATE TRIGGER reject_notification_receipt BEFORE INSERT ON processed_events FOR EACH ROW EXECUTE FUNCTION reject_notification_receipt()',
    );
    // 隔离队列省略退避延迟，仍执行五次真实数据库尝试；生产dispatcher的指数退避保持原样
    const job = await queue.add(
      'notification.deliver',
      { schemaVersion: 1, notificationId: id, eventId: row.eventId },
      { jobId: row.eventId, attempts: 5, removeOnFail: false },
    );
    await expect.poll(() => job.getState()).toBe('failed');
    const failed = await read(id);
    expect(failed).toMatchObject({
      status: 'failed',
      attempts: 5,
      errorCode: 'DELIVERY_FAILED',
      deliveredAt: null,
      readAt: null,
    });
    expect(
      (
        await stack.owner.pool.query(
          'SELECT event_id FROM processed_events WHERE consumer=$1 AND event_id=$2',
          ['notifications', row.eventId],
        )
      ).rows,
    ).toEqual([]);
    expect((await queue.getJob(row.eventId))?.failedReason).toBe('NOTIFICATION_DELIVERY_FAILED');
    await stack.owner.pool.query('DROP TRIGGER reject_notification_receipt ON processed_events');
    await stack.owner.pool.query('DROP FUNCTION reject_notification_receipt()');
    expect(
      await deliverNotification(
        stack.owner,
        { schemaVersion: 1, notificationId: id, eventId: row.eventId },
        { number: 1, last: true },
      ),
    ).toBe('duplicate');
    expect((await read(id)).status).toBe('failed');
  } finally {
    await queue.close();
  }
});
it('投递前封禁的接收者不会收到消息，完成记录和不可用状态保留以便核对', async () => {
  const payload = await input();
  const id = await stack.owner.db.transaction((tx) => enqueueNotification(tx, payload));
  await stack.owner.pool.query("UPDATE users SET status='banned' WHERE id=$1", [
    payload.recipientId,
  ]);
  await stack.tick();
  await expect.poll(async () => (await read(id)).status).toBe('skipped');
  expect(await read(id)).toMatchObject({
    errorCode: 'TARGET_UNAVAILABLE',
    deliveredAt: null,
    readAt: null,
  });
  expect(
    await stack.owner.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, payload.recipientId),
          eq(notifications.status, 'delivered'),
        ),
      ),
  ).toEqual([]);
});
