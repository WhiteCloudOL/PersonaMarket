import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { notifications } from '@personamarket/database';
import {
  AdminNoticeResponseSchema,
  AdminNoticesResponseSchema,
  NotificationsResponseSchema,
  NotificationCountResponseSchema,
  NotificationReadResponseSchema,
  NotificationRecipientResponseSchema,
} from '@personamarket/contracts';
import { createSystemQueue, enqueueNotification } from '@personamarket/server';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator } from '../fixtures/creator.js';
import type { AuthHttp } from '../fixtures/auth-http.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
  expect(stack.env.QUEUE_NAME).toBe(stack.worker.name);
});
afterEach(async () => {
  await stack?.close();
});
const nonce = () => ({ 'Idempotency-Key': randomUUID() });
async function count(http: AuthHttp) {
  return NotificationCountResponseSchema.parse(
    await (await http.raw('/api/v1/me/notifications/count')).json(),
  ).data;
}
async function recipient(http: AuthHttp, username: string) {
  const response = await http.raw(
    '/api/v1/admin/notifications/recipients/lookup?username=' + encodeURIComponent(username),
  );
  expect(response.status).toBe(200);
  return NotificationRecipientResponseSchema.parse(await response.json()).data;
}
async function send(http: AuthHttp, recipientId: string, suffix = '') {
  const response = await http.write(
    '/api/v1/admin/notifications',
    {
      recipientId,
      title: '真实管理员通知' + suffix,
      message: '私有通知原文\n<script>window.noticeXss=1</script>' + suffix,
      confirmed: true,
    },
    'POST',
    nonce(),
  );
  expect(response.status).toBe(200);
  return AdminNoticeResponseSchema.parse(await response.json()).data;
}
it('管理员按实际收件人创建通知，正常会话不追加近期验证；未投递不展示，幂等、本人已读和权限隔离真实生效', async () => {
  const receiver = await verifiedCreator(stack),
    other = await verifiedCreator(stack),
    admin = await stack.admin();
  const to = await recipient(admin.http, receiver.username.toUpperCase());
  expect(to.username).toBe(receiver.username);
  expect(JSON.stringify(to)).not.toContain('email');
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET created_at=now()-interval '20 minutes',mfa_verified_at=now()-interval '20 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
    [admin.credentials.username],
  );
  const input = {
      recipientId: to.id,
      title: '真实的重要通知',
      message: '私有原文\n保留空白 ',
      confirmed: true,
    },
    key = nonce();
  expect((await stack.browser().raw('/api/v1/me/notifications')).status).toBe(401);
  expect((await receiver.http.raw('/api/v1/admin/notifications')).status).toBe(403);
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/notifications',
        { ...input, actorId: randomUUID() },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/notifications',
        { ...input, confirmed: false },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(400);
  const [response, concurrent] = await Promise.all([
    admin.http.write('/api/v1/admin/notifications', input, 'POST', key),
    admin.http.write('/api/v1/admin/notifications', input, 'POST', key),
  ]);
  expect(response.status).toBe(200);
  expect(concurrent?.status).toBe(200);
  const notice = AdminNoticeResponseSchema.parse(await response.json()).data;
  expect(AdminNoticeResponseSchema.parse(await concurrent.json()).data.id).toBe(notice.id);
  expect(notice.status).toBe('queued');
  expect(await count(receiver.http)).toEqual({ unreadCount: 0, throughId: null });
  expect(
    NotificationsResponseSchema.parse(
      await (await receiver.http.raw('/api/v1/me/notifications')).json(),
    ).data,
  ).toEqual([]);
  expect(
    (await receiver.http.write('/api/v1/me/notifications/' + notice.id + '/read', {}, 'PATCH'))
      .status,
  ).toBe(404);
  await stack.tick();
  await expect.poll(async () => (await count(receiver.http)).unreadCount).toBe(1);
  expect((await admin.http.write('/api/v1/admin/notifications', input, 'POST', key)).status).toBe(
    200,
  );
  const list = NotificationsResponseSchema.parse(
    await (await receiver.http.raw('/api/v1/me/notifications')).json(),
  );
  expect(list.data).toHaveLength(1);
  expect(list.data[0]).toMatchObject({
    id: notice.id,
    title: input.title,
    message: input.message,
    readAt: null,
    available: true,
    path: null,
  });
  expect(JSON.stringify(list)).not.toContain('recipientId');
  expect(JSON.stringify(list)).not.toContain('sourceId');
  expect(
    (await other.http.write('/api/v1/me/notifications/' + notice.id + '/read', {}, 'PATCH')).status,
  ).toBe(404);
  expect(
    (await other.http.write('/api/v1/me/notifications/read-all', { throughId: notice.id }, 'PATCH'))
      .status,
  ).toBe(404);
  expect((await other.http.raw('/api/v1/admin/notifications/' + notice.id)).status).toBe(403);
  expect((await count(other.http)).unreadCount).toBe(0);
  const path = '/api/v1/me/notifications/' + notice.id + '/read';
  expect((await receiver.http.raw(path, { method: 'PATCH', body: '{}' })).status).toBe(403);
  expect(
    NotificationReadResponseSchema.parse(
      await (await receiver.http.write(path, {}, 'PATCH')).json(),
    ).data.updated,
  ).toBe(1);
  expect(
    NotificationReadResponseSchema.parse(
      await (await receiver.http.write(path, {}, 'PATCH')).json(),
    ).data.updated,
  ).toBe(0);
  expect((await count(receiver.http)).unreadCount).toBe(0);
  expect((await receiver.http.raw('/api/v1/me/notifications?page=501')).status).toBe(400);
  expect(
    (
      await receiver.http.raw('/api/v1/me/notifications/count', {
        headers: { 'X-Expected-Account': randomUUID() },
      })
    ).status,
  ).toBe(409);
  const history = AdminNoticesResponseSchema.parse(
    await (await admin.http.raw('/api/v1/admin/notifications')).json(),
  );
  expect(history.meta.total).toBe(1);
  expect(history.data[0]?.status).toBe('delivered');
});
it('全部已读保留列表加载后送达的消息，22条真实队列消息分页无重复并能筛选未读', async () => {
  const receiver = await verifiedCreator(stack),
    account = (await receiver.http.context()).data.account;
  if (!account) throw new Error('缺少真实通知账号');
  const create = (index: number) =>
    stack.owner.db.transaction((tx) =>
      enqueueNotification(tx, {
        recipientId: account.id,
        actorId: null,
        sourceId: randomUUID(),
        kind: 'account_security',
        title: '账号安全提示 ' + index,
        message: '核对你的账号安全状态 ' + index,
        target: { type: 'account' },
      }),
    );
  await create(1);
  await create(2);
  await expect
    .poll(async () => {
      await stack.tick();
      return (await count(receiver.http)).unreadCount;
    })
    .toBe(2);
  const before = await count(receiver.http);
  if (!before.throughId) throw new Error('缺少已读截止通知');
  const last = await create(3);
  await expect
    .poll(async () => {
      await stack.tick();
      return (await count(receiver.http)).unreadCount;
    })
    .toBe(3);
  const marked = await receiver.http.write(
    '/api/v1/me/notifications/read-all',
    { throughId: before.throughId },
    'PATCH',
  );
  expect(marked.status).toBe(200);
  expect(NotificationReadResponseSchema.parse(await marked.json()).data.updated).toBe(2);
  expect((await count(receiver.http)).unreadCount).toBe(1);
  expect(
    NotificationsResponseSchema.parse(
      await (await receiver.http.raw('/api/v1/me/notifications?status=unread')).json(),
    ).data.map((row) => row.id),
  ).toEqual([last]);
  for (let index = 4; index <= 22; index++) await create(index);
  try {
    await expect
      .poll(async () => {
        await stack.tick();
        return (await count(receiver.http)).unreadCount;
      })
      .toBe(20);
  } catch (cause) {
    const rows = await stack.owner.pool.query<{
      id: string;
      event_id: string;
      status: string;
      attempts: number;
      error_code: string | null;
      read: boolean;
    }>(
      'SELECT id,event_id,status,attempts,error_code,read_at IS NOT NULL AS read FROM notifications WHERE recipient_id=$1 ORDER BY created_at,id',
      [account.id],
    );
    if (!stack.worker.name.startsWith('auth-case-'))
      throw new Error('UNSAFE_DIAGNOSTIC_QUEUE', { cause });
    const queue = createSystemQueue(stack.env.REDIS_URL, stack.worker.name);
    let jobs;
    try {
      jobs = await Promise.all(
        rows.rows.map(async (row) => {
          const job = await queue.getJob(row.event_id);
          return {
            id: row.id,
            state: await job?.getState(),
            attempts: job?.attemptsMade,
            error: job?.failedReason,
          };
        }),
      );
    } finally {
      await queue.close();
    }
    throw new Error(
      'NOTIFICATION_PAGINATION_DIAGNOSTICS ' + JSON.stringify({ rows: rows.rows, jobs }),
      { cause },
    );
  }
  const first = NotificationsResponseSchema.parse(
      await (await receiver.http.raw('/api/v1/me/notifications')).json(),
    ),
    second = NotificationsResponseSchema.parse(
      await (await receiver.http.raw('/api/v1/me/notifications?page=2')).json(),
    );
  expect(first.meta.total).toBe(22);
  expect(first.data).toHaveLength(20);
  expect(second.data).toHaveLength(2);
  expect(new Set([...first.data, ...second.data].map((row) => row.id)).size).toBe(22);
  expect(first.meta.throughId).toBe(first.data[0]?.id);
});
it('失败通知通过真实管理接口重投，CAS和幂等防止并发重复，原任务重放不干扰新投递', async () => {
  const receiver = await verifiedCreator(stack),
    admin = await stack.admin(),
    to = await recipient(admin.http, receiver.username);
  const notice = await send(admin.http, to.id);
  const [original] = await stack.owner.db
    .select()
    .from(notifications)
    .where(eq(notifications.id, notice.id));
  if (!original) throw new Error('缺少通知投递记录');
  const queue = createSystemQueue(stack.env.REDIS_URL, stack.worker.name);
  try {
    await stack.owner.pool.query(
      "CREATE FUNCTION reject_notice_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.consumer='notifications' THEN RAISE EXCEPTION 'CONTROLLED_NOTICE_FAILURE' USING ERRCODE='23514'; END IF; RETURN NEW; END; $$",
    );
    await stack.owner.pool.query(
      'CREATE TRIGGER reject_notice_receipt BEFORE INSERT ON processed_events FOR EACH ROW EXECUTE FUNCTION reject_notice_receipt()',
    );
    const job = await queue.add(
      'notification.deliver',
      { schemaVersion: 1, notificationId: notice.id, eventId: original.eventId },
      { jobId: original.eventId, attempts: 5, removeOnFail: false },
    );
    await expect.poll(() => job.getState()).toBe('failed');
    const failed = AdminNoticeResponseSchema.parse(
      await (await admin.http.raw('/api/v1/admin/notifications/' + notice.id)).json(),
    ).data;
    expect(failed).toMatchObject({ status: 'failed', revision: 1, attempts: 5 });
    await stack.owner.pool.query('DROP TRIGGER reject_notice_receipt ON processed_events');
    await stack.owner.pool.query('DROP FUNCTION reject_notice_receipt()');
    const path = '/api/v1/admin/notifications/' + notice.id + '/retry',
      body = { expectedRevision: failed.revision, confirmed: true },
      key = nonce();
    const retry = await admin.http.write(path, body, 'POST', key);
    expect(retry.status).toBe(200);
    expect(AdminNoticeResponseSchema.parse(await retry.json()).data).toMatchObject({
      status: 'queued',
      revision: 2,
      attempts: 0,
    });
    expect((await admin.http.write(path, body, 'POST', key)).status).toBe(200);
    expect((await admin.http.write(path, body, 'POST', nonce())).status).toBe(412);
    const replay = await queue.add(
      'notification.deliver',
      { schemaVersion: 1, notificationId: notice.id, eventId: original.eventId },
      { jobId: randomUUID(), attempts: 1 },
    );
    await expect.poll(() => replay.getState()).toBe('completed');
    expect((await count(receiver.http)).unreadCount).toBe(0);
    await expect
      .poll(async () => {
        await stack.tick();
        return (await count(receiver.http)).unreadCount;
      })
      .toBe(1);
    const delivered = AdminNoticeResponseSchema.parse(
      await (await admin.http.raw('/api/v1/admin/notifications/' + notice.id)).json(),
    ).data;
    expect(delivered).toMatchObject({
      status: 'delivered',
      revision: 2,
      title: notice.title,
      message: notice.message,
    });
    expect(
      NotificationsResponseSchema.parse(
        await (await receiver.http.raw('/api/v1/me/notifications')).json(),
      ).data,
    ).toHaveLength(1);
    expect(
      (await admin.http.write(path, { expectedRevision: 2, confirmed: true }, 'POST', nonce()))
        .status,
    ).toBe(409);
    expect(
      (
        await stack.owner.pool.query(
          "SELECT count(*)::integer AS amount FROM auth_audit_events WHERE event='admin.notification_retried'",
        )
      ).rows[0]?.amount,
    ).toBe(1);
  } finally {
    await queue.close();
  }
});

it('失败状态本身暂时无法写入时，数据库恢复后的真实队列核对补记失败并允许受控重投', async () => {
  const receiver = await verifiedCreator(stack),
    admin = await stack.admin(),
    to = await recipient(admin.http, receiver.username);
  const notice = await send(admin.http, to.id);
  const [original] = await stack.owner.db
    .select()
    .from(notifications)
    .where(eq(notifications.id, notice.id));
  if (!original) throw new Error('缺少受控通知');
  const queue = createSystemQueue(stack.env.REDIS_URL, stack.worker.name);
  try {
    await stack.worker.pause();
    await stack.owner.pool.query(
      "CREATE FUNCTION reject_notification_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'CONTROLLED_NOTIFICATION_WRITE_FAILURE' USING ERRCODE='23514'; END; $$",
    );
    await stack.owner.pool.query(
      'CREATE TRIGGER reject_notification_update BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION reject_notification_update()',
    );
    const job = await queue.add(
      'notification.deliver',
      { schemaVersion: 1, notificationId: notice.id, eventId: original.eventId },
      { jobId: original.eventId, attempts: 5, removeOnFail: false },
    );
    await stack.tick();
    await stack.worker.resume();
    await expect.poll(() => job.getState()).toBe('failed');
    expect((await queue.getJob(original.eventId))?.attemptsMade).toBe(5);
    const persisted = (
      await stack.owner.pool.query('SELECT status,attempts FROM notifications WHERE id=$1', [
        notice.id,
      ])
    ).rows[0];
    expect(persisted).toEqual({ status: 'queued', attempts: 0 });
    await stack.owner.pool.query('DROP TRIGGER reject_notification_update ON notifications');
    await stack.owner.pool.query('DROP FUNCTION reject_notification_update()');
    await stack.tick();
    const repaired = AdminNoticeResponseSchema.parse(
      await (await admin.http.raw('/api/v1/admin/notifications/' + notice.id)).json(),
    ).data;
    expect(repaired).toMatchObject({ status: 'failed', attempts: 5, revision: 1 });
    expect((await count(receiver.http)).unreadCount).toBe(0);
    expect(
      (
        await admin.http.write(
          '/api/v1/admin/notifications/' + notice.id + '/retry',
          { expectedRevision: 1, confirmed: true },
          'POST',
          nonce(),
        )
      ).status,
    ).toBe(200);
    await expect
      .poll(async () => {
        await stack.tick();
        return (await count(receiver.http)).unreadCount;
      })
      .toBe(1);
  } finally {
    await stack.worker.resume();
    await queue.close();
  }
});

it('Outbox第五次投递的有效租约不算失败，租约结束且重试用尽后才允许受控重投', async () => {
  const receiver = await verifiedCreator(stack),
    admin = await stack.admin(),
    to = await recipient(admin.http, receiver.username),
    notice = await send(admin.http, to.id);
  await stack.owner.pool.query(
    "UPDATE outbox_events SET attempts=5,lease_until=clock_timestamp()+interval '30 seconds' WHERE id=(SELECT event_id FROM notifications WHERE id=$1)",
    [notice.id],
  );
  const current = () =>
    admin.http
      .raw('/api/v1/admin/notifications/' + notice.id)
      .then(async (response) => AdminNoticeResponseSchema.parse(await response.json()).data);
  expect((await current()).status).toBe('queued');
  await stack.tick();
  expect((await current()).status).toBe('queued');
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/notifications/' + notice.id + '/retry',
        { expectedRevision: 1, confirmed: true },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(409);
  await stack.owner.pool.query(
    "UPDATE outbox_events SET lease_until=clock_timestamp()-interval '1 second',last_error_code='DELIVERY_FAILED' WHERE id=(SELECT event_id FROM notifications WHERE id=$1)",
    [notice.id],
  );
  await stack.tick();
  expect((await current()).status).toBe('failed');
  expect(
    (await stack.owner.pool.query('SELECT status FROM notifications WHERE id=$1', [notice.id]))
      .rows[0]?.status,
  ).toBe('failed');
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/notifications/' + notice.id + '/retry',
        { expectedRevision: 1, confirmed: true },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(200);
  await expect
    .poll(async () => {
      await stack.tick();
      return (await count(receiver.http)).unreadCount;
    })
    .toBe(1);
});
