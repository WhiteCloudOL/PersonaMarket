import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  AdminNoticeResponseSchema,
  AdminUserResponseSchema,
  ErrorResponseSchema,
  NotificationDeliveryDetailResponseSchema,
  NotificationRetryReceiptResponseSchema,
  NotificationsResponseSchema,
  SubmissionResponseSchema,
  type AdminNotice,
} from '@personamarket/contracts';
import {
  createAdministrator,
  createSystemQueue,
  createTotp,
  openSecret,
} from '@personamarket/server';
import { createAuthStack } from '../fixtures/auth-stack.js';
import type { AuthHttp } from '../fixtures/auth-http.js';
import { completePersona, verifiedCreator } from '../fixtures/creator.js';
import { setMaintenance } from '../fixtures/system-maintenance.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});
const root = '/api/v1/admin/notifications';
const key = () => ({ 'Idempotency-Key': randomUUID() });
const detailPath = (id: string) => root + '/deliveries/' + id;
const retryPath = (id: string, notice = true) =>
  root + (notice ? '/' : '/failures/') + id + '/retry';
const command = { expectedRevision: 1, confirmed: true };

async function administrator() {
  const username = 'bridge_' + randomUUID().replaceAll('-', '').slice(0, 12),
    password = 'Notification bridge administrator passphrase 2026';
  await createAdministrator(stack.owner, {
    username,
    email: username + '@fixture.invalid',
    password,
  });
  const http = stack.browser();
  expect((await http.write('/api/v1/auth/login', { identifier: username, password })).status).toBe(
    200,
  );
  return { http, credentials: { username, password } };
}
async function notice(http: AuthHttp, recipientId: string) {
  const response = await http.write(
    root,
    {
      recipientId,
      title: '隔离通知处置',
      message: '通知正文保持私有，不进入精确运维详情',
      confirmed: true,
    },
    'POST',
    key(),
  );
  expect(response.status).toBe(200);
  return AdminNoticeResponseSchema.parse(await response.json()).data;
}
async function identity(http: AuthHttp) {
  const account = (await http.context()).data.account;
  if (!account) throw new Error('缺少隔离测试账号');
  return account;
}
async function detail(http: AuthHttp, id: string) {
  const response = await http.raw(detailPath(id));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  return NotificationDeliveryDetailResponseSchema.parse(await response.json()).data;
}
async function receipt(http: AuthHttp, id: string, headers: Record<string, string>, revision = 1) {
  const response = await http.raw(detailPath(id) + '/retry-receipt?expectedRevision=' + revision, {
    headers,
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  return NotificationRetryReceiptResponseSchema.parse(await response.json()).data;
}
async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(code);
}
async function expire(username: string) {
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET created_at=now()-interval '20 minutes',mfa_verified_at=now()-interval '20 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
    [username],
  );
}
/** 合法有界终态夹具；不停止依赖、不造拒绝trigger，不声称发生真实故障。 */
async function failedFixture(id: string, queued = false) {
  await stack.owner.pool.query(
    'UPDATE outbox_events SET attempts=5,lease_until=NULL,delivered_at=NULL WHERE id=(SELECT event_id FROM notifications WHERE id=$1)',
    [id],
  );
  if (!queued)
    await stack.owner.pool.query(
      "UPDATE notifications SET status='failed',attempts=5,error_code='DELIVERY_FAILED',last_attempted_at=clock_timestamp(),completed_at=clock_timestamp() WHERE id=$1",
      [id],
    );
}
async function facts() {
  const response = await stack.owner.pool.query<{
    notifications: number;
    events: number;
    audit: number;
    requests: number;
  }>(
    `SELECT (SELECT count(*)::int FROM notifications) AS notifications,
      (SELECT count(*)::int FROM outbox_events WHERE topic='notification.deliver') AS events,
      (SELECT count(*)::int FROM auth_audit_events WHERE event='admin.notification_retried') AS audit,
      (SELECT count(*)::int FROM idempotency_keys WHERE operation LIKE 'notification.%.retry') AS requests`,
  );
  return response.rows[0];
}

it('精确详情四种状态、白名单、当前consumer与未知执行次数分别保留，GET没有业务写副作用', async () => {
  const receiver = await verifiedCreator(stack),
    admin = await administrator(),
    recipient = await identity(receiver.http),
    entries: AdminNotice[] = [];
  for (let index = 0; index < 4; index++) entries.push(await notice(admin.http, recipient.id));
  const [queued, delivered, skipped, failed] = entries;
  if (!queued || !delivered || !skipped || !failed) throw new Error('缺少四状态夹具');
  await failedFixture(failed.id);
  for (const [entry, status] of [
    [delivered, 'delivered'],
    [skipped, 'skipped'],
  ] as const) {
    await stack.owner.pool.query(
      'UPDATE outbox_events SET attempts=1,delivered_at=clock_timestamp() WHERE id=(SELECT event_id FROM notifications WHERE id=$1)',
      [entry.id],
    );
    await stack.owner.pool.query(
      "UPDATE notifications SET status=$2::text,attempts=1,last_attempted_at=clock_timestamp(),completed_at=clock_timestamp(),delivered_at=CASE WHEN $2::text='delivered' THEN clock_timestamp() ELSE NULL END,error_code=CASE WHEN $2::text='skipped' THEN 'TARGET_UNAVAILABLE' ELSE NULL END WHERE id=$1",
      [entry.id, status],
    );
    await stack.owner.pool.query(
      "INSERT INTO processed_events(consumer,event_id) SELECT 'notifications',event_id FROM notifications WHERE id=$1",
      [entry.id],
    );
  }
  // 别的consumer处理相同UUID不能冒充通知消费回执
  await stack.owner.pool.query(
    "INSERT INTO processed_events(consumer,event_id) SELECT 'fixture-other',event_id FROM notifications WHERE id=$1",
    [queued.id],
  );
  const before = await facts();
  for (const [entry, status] of [
    [queued, 'queued'],
    [delivered, 'delivered'],
    [skipped, 'skipped'],
    [failed, 'failed'],
  ] as const) {
    const value = await detail(admin.http, entry.id);
    expect(value.status).toBe(status);
    expect(value.scope).toBe('notice');
    expect(value.recipient).toEqual({ id: recipient.id, username: receiver.username });
    expect(value.currentEventProcessed).toBe(status === 'delivered' || status === 'skipped');
    expect(value.executionAttempts).toBe(status === 'delivered' || status === 'skipped' ? 1 : null);
    expect(Object.keys(value).sort()).toEqual(
      [
        'completedAt',
        'createdAt',
        'currentEventProcessed',
        'deliveredAt',
        'dispatchAttempts',
        'errorCode',
        'eventId',
        'executionAttempts',
        'id',
        'kind',
        'lastAttemptedAt',
        'recipient',
        'requiresRecentVerification',
        'retryAllowed',
        'retryBlockedReason',
        'revision',
        'scope',
        'status',
      ].sort(),
    );
  }
  expect(await facts()).toEqual(before);
});

it('匿名/普通/审核员与错误预期账号均拒绝，回执严格查询且不暴露其他管理员记录', async () => {
  const receiver = await verifiedCreator(stack),
    admin = await stack.admin(),
    recipient = await identity(receiver.http),
    entry = await notice(admin.http, recipient.id),
    endpoint = detailPath(entry.id);
  for (const path of [endpoint, endpoint + '/retry-receipt?expectedRevision=1']) {
    const options = { headers: key() };
    await error(await stack.browser().raw(path, options), 401, 'UNAUTHENTICATED');
    await error(await receiver.http.raw(path, options), 403, 'FORBIDDEN');
    await error(
      await admin.http.raw(path, { headers: { ...key(), 'X-Expected-Account': randomUUID() } }),
      409,
      'CONFLICT',
    );
  }
  const user = AdminUserResponseSchema.parse(
    await (await admin.http.raw('/api/v1/admin/users/' + recipient.id)).json(),
  ).data;
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/users/' + recipient.id + '/role',
        {
          role: 'moderator',
          expectedSecurityVersion: user.securityVersion,
          reason: '隔离普通权限验收',
        },
        'PUT',
        key(),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await receiver.http.write('/api/v1/auth/login', {
        identifier: receiver.username,
        password: receiver.password,
      })
    ).status,
  ).toBe(200);
  await error(await receiver.http.raw(endpoint), 403, 'FORBIDDEN');
  await error(
    await receiver.http.raw(endpoint + '/retry-receipt?expectedRevision=1', { headers: key() }),
    403,
    'FORBIDDEN',
  );
  await error(
    await admin.http.raw(endpoint + '/retry-receipt?expectedRevision=1'),
    400,
    'INVALID_INPUT',
  );
  for (const query of ['expectedRevision=0', 'expectedRevision=1&other=1'])
    expect(
      (await admin.http.raw(endpoint + '/retry-receipt?' + query, { headers: key() })).status,
    ).toBe(400);
  expect((await admin.http.raw(detailPath(randomUUID()))).status).toBe(404);
  expect(
    (
      await admin.http.raw(detailPath(randomUUID()) + '/retry-receipt?expectedRevision=1', {
        headers: key(),
      })
    ).status,
  ).toBe(404);
});

it('queued耗尽保持原业务状态可精确重投，活跃租约及未耗尽不增加事件或操作', async () => {
  const receiver = await verifiedCreator(stack),
    admin = await administrator(),
    recipient = await identity(receiver.http),
    expired = await notice(admin.http, recipient.id),
    leased = await notice(admin.http, recipient.id),
    pending = await notice(admin.http, recipient.id);
  await failedFixture(expired.id, true);
  await failedFixture(leased.id, true);
  await stack.owner.pool.query(
    "UPDATE outbox_events SET lease_until=clock_timestamp()+interval '1 minute' WHERE id=(SELECT event_id FROM notifications WHERE id=$1)",
    [leased.id],
  );
  await stack.owner.pool.query(
    'UPDATE outbox_events SET attempts=4 WHERE id=(SELECT event_id FROM notifications WHERE id=$1)',
    [pending.id],
  );
  expect(await detail(admin.http, expired.id)).toMatchObject({
    status: 'queued',
    dispatchAttempts: 5,
    executionAttempts: null,
    retryAllowed: true,
  });
  const before = await facts();
  for (const entry of [leased, pending]) {
    expect((await detail(admin.http, entry.id)).retryBlockedReason).toBe('NOT_FAILED');
    await error(
      await admin.http.write(retryPath(entry.id), command, 'POST', key()),
      409,
      'CONFLICT',
    );
  }
  expect(await facts()).toEqual(before);
  await expire(admin.credentials.username);
  expect((await admin.http.write(retryPath(expired.id), command, 'POST', key())).status).toBe(200);
  expect(await detail(admin.http, expired.id)).toMatchObject({
    status: 'queued',
    revision: 2,
    dispatchAttempts: 0,
    executionAttempts: null,
    retryAllowed: false,
  });
});

it('当前Outbox主题/版本/对象/额外字段不匹配时详情只读且原POST也拒绝', async () => {
  const receiver = await verifiedCreator(stack),
    admin = await administrator(),
    recipient = await identity(receiver.http);
  const variants = [
    { topic: 'auth.email', payload: { schemaVersion: 1, notificationId: randomUUID() } },
    { topic: 'notification.deliver', payload: { schemaVersion: 2, notificationId: randomUUID() } },
    { topic: 'notification.deliver', payload: { schemaVersion: 1, notificationId: randomUUID() } },
    {
      topic: 'notification.deliver',
      payload: { schemaVersion: 1, notificationId: randomUUID(), message: '禁止额外内容' },
    },
  ];
  for (const variant of variants) {
    const entry = await notice(admin.http, recipient.id);
    await failedFixture(entry.id);
    await stack.owner.pool.query(
      'UPDATE outbox_events SET topic=$2,payload=$3::jsonb WHERE id=(SELECT event_id FROM notifications WHERE id=$1)',
      [entry.id, variant.topic, JSON.stringify(variant.payload)],
    );
    const before = await facts(),
      value = await detail(admin.http, entry.id);
    expect(value).toMatchObject({
      status: 'failed',
      dispatchAttempts: null,
      executionAttempts: null,
      retryAllowed: false,
      retryBlockedReason: 'STATE_UNVERIFIABLE',
    });
    await error(
      await admin.http.write(retryPath(entry.id), command, 'POST', key()),
      409,
      'CONFLICT',
    );
    expect(await facts()).toEqual(before);
  }
});

it('同修订并发只受理一轮，原key只读核对和同载荷重放不新增副作用，不能借scope或别人的回执', async () => {
  const receiver = await verifiedCreator(stack),
    admin = await administrator(),
    other = await administrator(),
    entry = await notice(admin.http, (await identity(receiver.http)).id);
  await failedFixture(entry.id);
  const before = await facts(),
    first = key(),
    second = key();
  const responses = await Promise.all([
    admin.http.write(retryPath(entry.id), command, 'POST', first),
    admin.http.write(retryPath(entry.id), command, 'POST', second),
  ]);
  expect(responses.map((value) => value.status).sort()).toEqual([200, 412]);
  const original = responses[0]?.status === 200 ? first : second;
  expect(await receipt(admin.http, entry.id, original)).toMatchObject({
    notificationId: entry.id,
    recorded: true,
  });
  expect(await receipt(other.http, entry.id, original)).toMatchObject({
    recorded: false,
    recordedAt: null,
  });
  expect(await receipt(admin.http, entry.id, key())).toMatchObject({
    recorded: false,
    recordedAt: null,
  });
  await error(
    await admin.http.raw(detailPath(entry.id) + '/retry-receipt?expectedRevision=2', {
      headers: original,
    }),
    409,
    'CONFLICT',
  );
  expect((await admin.http.write(retryPath(entry.id), command, 'POST', original)).status).toBe(200);
  await error(
    await admin.http.write(
      retryPath(entry.id),
      { ...command, expectedRevision: 2 },
      'POST',
      original,
    ),
    409,
    'CONFLICT',
  );
  await error(
    await admin.http.write(retryPath(entry.id, false), command, 'POST', original),
    404,
    'NOT_FOUND',
  );
  const after = await facts();
  expect(after).toEqual({
    notifications: before?.notifications,
    events: (before?.events ?? 0) + 1,
    audit: (before?.audit ?? 0) + 1,
    requests: (before?.requests ?? 0) + 1,
  });
  await expire(admin.credentials.username);
  expect((await receipt(admin.http, entry.id, original)).recorded).toBe(true);
  expect(await facts()).toEqual(after);
});

async function securityNotification() {
  const receiver = await verifiedCreator(stack),
    next = 'Notification security changed passphrase 2026';
  expect(
    (
      await receiver.http.write('/api/v1/me/security/password', {
        currentPassword: receiver.password,
        newPassword: next,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await receiver.http.write('/api/v1/auth/login', {
        identifier: receiver.username,
        password: next,
      })
    ).status,
  ).toBe(200);
  const [row] = (
    await stack.owner.pool.query<{ id: string }>(
      "SELECT n.id FROM notifications n JOIN users u ON u.id=n.recipient_id WHERE n.kind='account_security' AND u.username=$1 ORDER BY n.created_at DESC LIMIT 1",
      [receiver.username],
    )
  ).rows;
  if (!row) throw new Error('真实密码业务没有生成安全通知');
  await failedFixture(row.id);
  return { receiver, id: row.id };
}

it('敏感业务POST在原key重放前仍要求近期密码，过期后的回执GET只核对不发送', async () => {
  const current = await securityNotification(),
    admin = await administrator(),
    nonce = key();
  await expire(admin.credentials.username);
  expect(await detail(admin.http, current.id)).toMatchObject({
    scope: 'business',
    requiresRecentVerification: true,
    retryAllowed: true,
  });
  await error(
    await admin.http.write(retryPath(current.id, false), command, 'POST', nonce),
    403,
    'REAUTH_REQUIRED',
  );
  expect((await receipt(admin.http, current.id, nonce)).recorded).toBe(false);
  expect(
    (
      await admin.http.write('/api/v1/auth/reauthenticate', {
        currentPassword: admin.credentials.password,
      })
    ).status,
  ).toBe(200);
  expect(
    (await admin.http.write(retryPath(current.id, false), command, 'POST', nonce)).status,
  ).toBe(200);
  await expire(admin.credentials.username);
  const before = await facts();
  expect((await receipt(admin.http, current.id, nonce)).recorded).toBe(true);
  await error(
    await admin.http.write(retryPath(current.id, false), command, 'POST', nonce),
    403,
    'REAUTH_REQUIRED',
  );
  expect(await facts()).toEqual(before);
});

it('已绑定MFA的敏感POST不能密码旁路，近期过期不阻断只读原请求回执', async () => {
  const current = await securityNotification(),
    admin = await stack.admin(),
    nonce = key();
  await expire(admin.credentials.username);
  await error(
    await admin.http.write(retryPath(current.id, false), command, 'POST', nonce),
    403,
    'MFA_REQUIRED',
  );
  expect(
    (
      await admin.http.write('/api/v1/auth/reauthenticate', {
        currentPassword: admin.credentials.password,
      })
    ).status,
  ).toBe(403);
  const account = await identity(admin.http),
    [row] = (
      await stack.owner.pool.query<{ encrypted_secret: string }>(
        'SELECT encrypted_secret FROM user_mfa WHERE user_id=$1',
        [account.id],
      )
    ).rows;
  if (!row) throw new Error('缺少本测试MFA资料');
  const secret = openSecret(
    stack.env.APP_ENCRYPTION_KEY,
    'mfa:' + account.id,
    row.encrypted_secret,
  );
  expect(
    (
      await admin.http.write('/api/v1/auth/mfa/verify', {
        code: createTotp(secret, admin.credentials.username).generate({
          timestamp: Date.now() + 30000,
        }),
      })
    ).status,
  ).toBe(200);
  expect(
    (await admin.http.write(retryPath(current.id, false), command, 'POST', nonce)).status,
  ).toBe(200);
  await expire(admin.credentials.username);
  expect((await receipt(admin.http, current.id, nonce)).recorded).toBe(true);
  await error(
    await admin.http.write(retryPath(current.id, false), command, 'POST', nonce),
    403,
    'MFA_REQUIRED',
  );
});

it('真实Worker处理重投与旧事件重复，维护中仍投递且原请求回执不冒充历史event', async () => {
  const receiver = await verifiedCreator(stack),
    admin = await administrator(),
    entry = await notice(admin.http, (await identity(receiver.http)).id),
    nonce = key(),
    original = await detail(admin.http, entry.id);
  await failedFixture(entry.id, true);
  await setMaintenance(admin.http, true, '隔离维护不中断管理员通知处置');
  expect((await admin.http.write(retryPath(entry.id), command, 'POST', nonce)).status).toBe(200);
  const accepted = await detail(admin.http, entry.id);
  expect(accepted.eventId).not.toBe(original.eventId);
  const queue = createSystemQueue(stack.env.REDIS_URL, stack.worker.name);
  try {
    await queue.add(
      'notification.deliver',
      { schemaVersion: 1, notificationId: entry.id, eventId: original.eventId },
      { jobId: original.eventId, attempts: 5 },
    );
    await expect
      .poll(async () => {
        await stack.tick();
        return (await detail(admin.http, entry.id)).status;
      })
      .toBe('delivered');
    const delivered = await detail(admin.http, entry.id);
    expect(delivered).toMatchObject({
      eventId: accepted.eventId,
      revision: 2,
      currentEventProcessed: true,
      executionAttempts: 1,
      retryAllowed: false,
    });
    const records = await stack.owner.pool.query<{ event_id: string }>(
      "SELECT event_id FROM processed_events WHERE consumer='notifications' AND event_id=ANY($1::uuid[])",
      [[original.eventId, accepted.eventId]],
    );
    expect(records.rows.map((row) => row.event_id).sort()).toEqual(
      [original.eventId, accepted.eventId].sort(),
    );
    const before = await facts();
    expect((await receipt(admin.http, entry.id, nonce)).recorded).toBe(true);
    expect(await facts()).toEqual(before);
    expect(
      NotificationsResponseSchema.parse(
        await (await receiver.http.raw('/api/v1/me/notifications')).json(),
      ).data.filter((row) => row.id === entry.id),
    ).toHaveLength(1);
    await error(
      await admin.http.write(
        retryPath(entry.id),
        { ...command, expectedRevision: 2 },
        'POST',
        key(),
      ),
      409,
      'CONFLICT',
    );
  } finally {
    await queue.close();
  }
});

it('接受重投后收件资格变化由真实Worker标skipped，不将任务消失冒充已送达', async () => {
  const receiver = await verifiedCreator(stack),
    admin = await administrator(),
    recipient = await identity(receiver.http),
    entry = await notice(admin.http, recipient.id);
  await failedFixture(entry.id);
  expect((await admin.http.write(retryPath(entry.id), command, 'POST', key())).status).toBe(200);
  // 受控正常账号终态夹具；真实Worker仍需在消费时复查资格
  await stack.owner.pool.query(
    "UPDATE users SET status='banned',security_version=security_version+1 WHERE id=$1",
    [recipient.id],
  );
  await expect
    .poll(async () => {
      await stack.tick();
      return (await detail(admin.http, entry.id)).status;
    })
    .toBe('skipped');
  expect(await detail(admin.http, entry.id)).toMatchObject({
    status: 'skipped',
    deliveredAt: null,
    errorCode: 'TARGET_UNAVAILABLE',
    currentEventProcessed: true,
    retryAllowed: false,
  });
  const before = await facts();
  await error(
    await admin.http.write(retryPath(entry.id), { ...command, expectedRevision: 2 }, 'POST', key()),
    409,
    'CONFLICT',
  );
  expect(await facts()).toEqual(before);
});

it('真实审核业务通知沿business专用命令且不追加近期验证，已失效收件账号保持拒绝', async () => {
  const receiver = await verifiedCreator(stack),
    admin = await administrator(),
    recipient = await identity(receiver.http),
    persona = await completePersona(receiver.http);
  const response = await receiver.http.write(
    '/api/v1/me/personas/' + persona.id + '/releases',
    {
      version: '1.0.0',
      expectedDraftRevision: persona.revision,
      changelog: '通知桥接正常审核',
      confirmed: true,
    },
    'POST',
    key(),
  );
  expect(response.status).toBe(200);
  const submission = SubmissionResponseSchema.parse(await response.json()).data;
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/moderation/submissions/' + submission.id + '/review',
        {
          action: 'approve',
          expectedRevision: submission.revision,
          reason: '隔离他人作品审核',
          selfReviewConfirmed: false,
        },
        'POST',
        key(),
      )
    ).status,
  ).toBe(200);
  const [row] = (
    await stack.owner.pool.query<{ id: string }>(
      "SELECT id FROM notifications WHERE recipient_id=$1 AND kind='release_approved'",
      [recipient.id],
    )
  ).rows;
  if (!row) throw new Error('真实审核没有生成通知');
  const pending = await notice(admin.http, recipient.id);
  await failedFixture(row.id);
  await failedFixture(pending.id);
  await expire(admin.credentials.username);
  expect(await detail(admin.http, row.id)).toMatchObject({
    kind: 'release_approved',
    scope: 'business',
    requiresRecentVerification: false,
    retryAllowed: true,
  });
  const nonce = key();
  expect((await admin.http.write(retryPath(row.id, false), command, 'POST', nonce)).status).toBe(
    200,
  );
  expect((await receipt(admin.http, row.id, nonce)).recorded).toBe(true);
  await error(await admin.http.write(retryPath(row.id), command, 'POST', nonce), 404, 'NOT_FOUND');
  await stack.owner.pool.query(
    "UPDATE users SET status='banned',security_version=security_version+1 WHERE id=$1",
    [recipient.id],
  );
  expect((await detail(admin.http, pending.id)).retryBlockedReason).toBe('RECIPIENT_UNAVAILABLE');
  const before = await facts();
  await error(
    await admin.http.write(retryPath(pending.id), command, 'POST', key()),
    409,
    'CONFLICT',
  );
  expect(await facts()).toEqual(before);
});

it('原请求回执须同时匹配hash与resultId，不能把另一通知的已受理记录当本对象成功', async () => {
  const receiver = await verifiedCreator(stack),
    admin = await administrator(),
    recipient = await identity(receiver.http),
    entry = await notice(admin.http, recipient.id),
    other = await notice(admin.http, recipient.id),
    nonce = key();
  await failedFixture(entry.id);
  expect((await admin.http.write(retryPath(entry.id), command, 'POST', nonce)).status).toBe(200);
  const before = await facts();
  await error(
    await admin.http.raw(detailPath(other.id) + '/retry-receipt?expectedRevision=1', {
      headers: nonce,
    }),
    409,
    'CONFLICT',
  );
  // 仅此隔离库的非法旧回执样本；不改约束、不制造基础设施故障
  await stack.owner.pool.query(
    "UPDATE idempotency_keys SET result_id=$1 WHERE actor_id=$2 AND operation='notification.notice.retry' AND key=$3",
    [other.id, (await identity(admin.http)).id, nonce['Idempotency-Key']],
  );
  await error(
    await admin.http.raw(detailPath(entry.id) + '/retry-receipt?expectedRevision=1', {
      headers: nonce,
    }),
    409,
    'CONFLICT',
  );
  expect(await facts()).toEqual(before);
});

it('failed但当前派发租约仍活跃时保持无法核验，两条原POST均不新增轮次', async () => {
  const security = await securityNotification(),
    admin = await administrator(),
    entry = await notice(admin.http, (await identity(security.receiver.http)).id);
  await failedFixture(entry.id);
  for (const sample of [
    { id: entry.id, notice: true, dispatched: false },
    { id: security.id, notice: false, dispatched: true },
  ]) {
    await stack.owner.pool.query(
      "UPDATE outbox_events SET lease_until=clock_timestamp()+interval '1 minute',delivered_at=CASE WHEN $2::boolean THEN clock_timestamp() ELSE NULL END WHERE id=(SELECT event_id FROM notifications WHERE id=$1)",
      [sample.id, sample.dispatched],
    );
    expect(await detail(admin.http, sample.id)).toMatchObject({
      status: 'failed',
      retryAllowed: false,
      retryBlockedReason: 'STATE_UNVERIFIABLE',
    });
    const before = await facts();
    await error(
      await admin.http.write(retryPath(sample.id, sample.notice), command, 'POST', key()),
      409,
      'CONFLICT',
    );
    expect(await facts()).toEqual(before);
    await stack.owner.pool.query(
      "UPDATE outbox_events SET lease_until=clock_timestamp()-interval '1 second' WHERE id=(SELECT event_id FROM notifications WHERE id=$1)",
      [sample.id],
    );
    expect((await detail(admin.http, sample.id)).retryAllowed).toBe(true);
  }
});

it('写额度耗尽后原POST返回429，只读原请求回执仍可核对且不重复创建投递', async () => {
  const receiver = await verifiedCreator(stack),
    admin = await administrator(),
    entry = await notice(admin.http, (await identity(receiver.http)).id),
    originalKey = key();
  await failedFixture(entry.id);
  const before = await facts(),
    original = await detail(admin.http, entry.id);
  if (!before) throw new Error('缺少原始通知事实');
  expect((await admin.http.write(retryPath(entry.id), command, 'POST', originalKey)).status).toBe(
    200,
  );
  const accepted = await detail(admin.http, entry.id);
  expect(accepted).toMatchObject({ status: 'queued', revision: 2 });
  expect(accepted.eventId).not.toBe(original.eventId);
  // 创建1次、首次重投1次，再核对原载荷8次；不修改Redis或真实写限额
  for (let index = 0; index < 8; index++)
    expect((await admin.http.write(retryPath(entry.id), command, 'POST', originalKey)).status).toBe(
      200,
    );
  const once = await facts();
  expect(once).toEqual({
    notifications: before.notifications,
    events: before.events + 1,
    audit: before.audit + 1,
    requests: before.requests + 1,
  });
  const limited = await admin.http.write(retryPath(entry.id), command, 'POST', originalKey);
  await error(limited, 429, 'RATE_LIMITED');
  expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  const recorded = await receipt(admin.http, entry.id, originalKey);
  expect(recorded).toMatchObject({ notificationId: entry.id, recorded: true });
  expect(recorded.recordedAt).not.toBeNull();
  expect(await detail(admin.http, entry.id)).toMatchObject({
    eventId: accepted.eventId,
    status: 'queued',
    revision: 2,
    currentEventProcessed: false,
  });
  expect(await facts()).toEqual(once);
});
