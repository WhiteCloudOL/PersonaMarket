import { afterEach, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AdminTaskListResponseSchema } from '@personamarket/contracts';
import { createAdministrator, enqueueNotification } from '@personamarket/server';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator } from '../fixtures/creator.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});

it('任务运维仅管理员可读，匿名、用户和审核员都不能取得私有任务信息', async () => {
  expect((await stack.browser().raw('/api/v1/admin/tasks')).status).toBe(401);
  const reader = await verifiedCreator(stack);
  expect((await reader.http.raw('/api/v1/admin/tasks')).status).toBe(403);
  await stack.owner.pool.query("UPDATE users SET role='moderator' WHERE username=$1", [
    reader.username,
  ]);
  expect(
    (
      await reader.http.write('/api/v1/auth/login', {
        identifier: reader.username,
        password: reader.password,
      })
    ).status,
  ).toBe(200);
  expect((await reader.http.raw('/api/v1/admin/tasks')).status).toBe(403);
  const admin = await stack.admin();
  const response = await admin.http.raw('/api/v1/admin/tasks');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(AdminTaskListResponseSchema.parse(await response.json())).toMatchObject({
    data: [],
    meta: { page: 1, pageSize: 20, total: 0 },
  });
});

it('失败列表读取真实分发及业务终态，一份通知不因两个失败阶段重复列出', async () => {
  const admin = await stack.admin();
  const account = (
    await stack.owner.pool.query<{ id: string }>('SELECT id FROM users WHERE username=$1', [
      admin.credentials.username,
    ])
  ).rows[0];
  if (!account) throw Error('管理员夹具缺失');
  const marker = 'TASK_PRIVATE_BODY_MUST_NOT_LEAK';
  const mailId = randomUUID(),
    probeId = randomUUID(),
    imageId = randomUUID(),
    rankingId = randomUUID();
  await stack.owner.pool.query(
    `INSERT INTO outbox_events(id,topic,payload,attempts,last_error_code) VALUES
      ($1,'auth.email',$3::jsonb,5,'DELIVERY_FAILED'),
      ($2,'system.probe',$3::jsonb,5,'DELIVERY_FAILED')`,
    [mailId, probeId, JSON.stringify({ schemaVersion: 1, encryptedMessage: marker })],
  );
  await stack.owner.pool.query(
    `INSERT INTO outbox_events(topic,payload,attempts,lease_until) VALUES
      ('system.probe','{"schemaVersion":1}',4,NULL),
      ('system.probe','{"schemaVersion":1}',5,now()+interval '1 hour')`,
  );
  await stack.owner.pool.query(
    `INSERT INTO asset_jobs(id,owner_id,source_url,status,error_code)
     VALUES ($1,$2,$3,'failed','IMAGE_IMPORT_FAILED')`,
    [imageId, account.id, 'https://private-source.invalid/' + marker],
  );
  await stack.owner.pool.query(
    `INSERT INTO outbox_events(topic,payload,attempts,delivered_at)
     VALUES ('asset.import',$1::jsonb,1,now())`,
    [JSON.stringify({ schemaVersion: 1, jobId: imageId })],
  );
  await stack.owner.pool.query(
    `INSERT INTO ranking_generations(id,request_key,algorithm,status,attempts,error_code)
     VALUES ($1,$2,'interactions-v1','failed',5,$3)`,
    [rankingId, 'task-fixture:' + randomUUID(), marker],
  );
  await stack.owner.pool.query(
    `INSERT INTO outbox_events(topic,payload,attempts,delivered_at)
     VALUES ('rankings.refresh',$1::jsonb,1,now())`,
    [JSON.stringify({ generationId: rankingId })],
  );
  const notificationId = await stack.owner.db.transaction((tx) =>
    enqueueNotification(tx, {
      recipientId: account.id,
      actorId: account.id,
      sourceId: randomUUID(),
      kind: 'admin_notice',
      title: marker,
      message: marker,
      target: { type: 'none' },
    }),
  );
  await stack.owner.pool.query(
    `UPDATE outbox_events SET attempts=5,last_error_code='DELIVERY_FAILED'
     WHERE id=(SELECT event_id FROM notifications WHERE id=$1)`,
    [notificationId],
  );
  await stack.tick();
  const response = await admin.http.raw('/api/v1/admin/tasks');
  expect(response.status).toBe(200);
  const body = AdminTaskListResponseSchema.parse(await response.json());
  expect(body.meta).toMatchObject({ page: 1, pageSize: 20, total: 5 });
  expect(body.data).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ source: 'dispatch', id: mailId, category: 'mail' }),
      expect.objectContaining({ source: 'dispatch', id: probeId, category: 'system' }),
      expect.objectContaining({ source: 'image', id: imageId, category: 'images' }),
      expect.objectContaining({ source: 'ranking', id: rankingId, category: 'rankings' }),
      expect.objectContaining({
        source: 'notification',
        id: notificationId,
        category: 'notifications',
        stage: 'dispatch',
      }),
    ]),
  );
  expect(body.data).toHaveLength(5);
  // 通知恢复器把分发耗尽写入attempts，不能冒充Worker实际执行了五次
  expect(body.data.find((row) => row.source === 'notification')?.executionAttempts).toBeNull();
  const serialized = JSON.stringify(body);
  for (const secret of [marker, admin.credentials.email, 'private-source.invalid', 'payload'])
    expect(serialized).not.toContain(secret);
  const filtered = await admin.http.raw('/api/v1/admin/tasks?category=mail');
  expect(filtered.status).toBe(200);
  expect(AdminTaskListResponseSchema.parse(await filtered.json())).toMatchObject({
    data: [{ source: 'dispatch', id: mailId, category: 'mail' }],
    meta: { total: 1 },
  });
  const executed = await admin.http.raw('/api/v1/admin/tasks?stage=execution');
  expect(executed.status).toBe(200);
  const execution = AdminTaskListResponseSchema.parse(await executed.json());
  expect(execution.meta.total).toBe(2);
  expect(execution.data.find((row) => row.source === 'image')?.executionAttempts).toBeNull();
  // 旧generation最大attempts=5不代表当前事件实际消费次数，缺少本轮台账须保留未知。
  expect(execution.data.find((row) => row.source === 'ranking')?.executionAttempts).toBeNull();
});

it('绑定与未绑定MFA的管理员都可在近期验证过期后只读任务列表', async () => {
  const bound = await stack.admin();
  const username = 'task_admin_' + randomUUID().replaceAll('-', '').slice(0, 10),
    password = 'A task administrator fixture password 2026';
  await createAdministrator(stack.owner, {
    username,
    password,
    email: username + '@fixture.invalid',
  });
  const unbound = stack.browser();
  expect(
    (await unbound.write('/api/v1/auth/login', { identifier: username, password })).status,
  ).toBe(200);
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET mfa_verified_at=now()-interval '1 hour' WHERE revoked_at IS NULL",
  );
  for (const http of [bound.http, unbound]) {
    const response = await http.raw('/api/v1/admin/tasks');
    expect(response.status).toBe(200);
    AdminTaskListResponseSchema.parse(await response.json());
  }
});

it('请求开始后并发撤销管理员角色，等待中的任务读取也被真实会话检查阻断', async () => {
  const admin = await stack.admin();
  await stack.admin();
  const blocker = await stack.owner.pool.connect();
  let committed = false;
  try {
    await blocker.query('BEGIN');
    await blocker.query("UPDATE users SET role='user' WHERE username=$1", [
      admin.credentials.username,
    ]);
    const pending = admin.http.raw('/api/v1/admin/tasks');
    await expect
      .poll(async () =>
        Number(
          (
            await stack.owner.pool.query<{ amount: string }>(
              "SELECT count(*) AS amount FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query ILIKE '%for no key update%'",
            )
          ).rows[0]?.amount ?? 0,
        ),
      )
      .toBeGreaterThan(0);
    await blocker.query('COMMIT');
    committed = true;
    const response = await pending;
    expect(response.status).toBe(401);
    expect(await response.json()).not.toHaveProperty('data');
  } finally {
    if (!committed) await blocker.query('ROLLBACK');
    blocker.release();
  }
});

it('分页稳定有界，错误筛选和账号切换不会被当作成功的空列表', async () => {
  const admin = await stack.admin();
  await stack.owner.pool.query(
    `INSERT INTO outbox_events(topic,payload,attempts,last_error_code,created_at)
     SELECT 'system.probe','{"schemaVersion":1}',5,'DELIVERY_FAILED',
       now()-make_interval(secs=>i) FROM generate_series(1,23) i`,
  );
  const first = await admin.http.raw('/api/v1/admin/tasks'),
    second = await admin.http.raw('/api/v1/admin/tasks?page=2');
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  const one = AdminTaskListResponseSchema.parse(await first.json()),
    two = AdminTaskListResponseSchema.parse(await second.json());
  expect(one.data).toHaveLength(20);
  expect(two.data).toHaveLength(3);
  expect(one.meta.total).toBe(23);
  expect(two.meta.total).toBe(23);
  const ids = [...one.data, ...two.data].map((row: { id: string }) => row.id);
  expect(new Set(ids).size).toBe(23);
  for (const query of ['page=0', 'page=501', 'category=arbitrary', 'stage=arbitrary'])
    expect((await admin.http.raw('/api/v1/admin/tasks?' + query)).status).toBe(400);
  expect(
    (
      await admin.http.raw('/api/v1/admin/tasks', {
        headers: { 'X-Expected-Account': randomUUID() },
      })
    ).status,
  ).toBe(409);
});
