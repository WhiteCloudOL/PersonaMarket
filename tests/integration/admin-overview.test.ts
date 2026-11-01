import { afterEach, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  AdminOverviewResponseSchema,
  CommentResponseSchema,
  SubmissionResponseSchema,
} from '@personamarket/contracts';
import { createAdministrator, createSystemQueue, inspectQueueUsage } from '@personamarket/server';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { completePersona, verifiedCreator } from '../fixtures/creator.js';
import { interactionRankingScenario } from '../fixtures/interaction-ranking-scenario.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});

it('概览拒绝匿名与普通账号，审核员仅有三个获授权队列', async () => {
  expect((await stack.browser().raw('/api/v1/admin/overview')).status).toBe(401);
  const reader = await verifiedCreator(stack);
  expect((await reader.http.raw('/api/v1/admin/overview')).status).toBe(403);
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
  const reply = await reader.http.raw('/api/v1/admin/overview');
  expect(reply.status).toBe(200);
  expect(await reply.json()).toMatchObject({
    data: { role: 'moderator', queues: { releases: 0, comments: 0, profiles: 0 } },
  });
  expect(
    Object.keys((await (await reader.http.raw('/api/v1/admin/overview')).json()).data).sort(),
  ).toEqual(['asOf', 'queues', 'role']);
});

it('管理员概览读取真实空队列与账号数，不用随机统计或伪造成功观测', async () => {
  const admin = await stack.admin();
  const reply = await admin.http.raw('/api/v1/admin/overview');
  expect(reply.status).toBe(200);
  expect(reply.headers.get('cache-control')).toBe('no-store');
  const body = AdminOverviewResponseSchema.parse(await reply.json());
  if (body.data.role !== 'admin') throw Error('应为管理员概览');
  expect(body).toMatchObject({
    data: {
      role: 'admin',
      queues: { releases: 0, comments: 0, profiles: 0, reports: 0 },
      catalog: {
        publicPersonas: 0,
        activeUsers: 1,
        newPublicPersonas7d: 0,
        newActiveUsers7d: 1,
        publishedReleases7d: 0,
      },
      interactions: { likes7d: 0, favorites7d: 0, comments7d: 0 },
      tasks: {
        dispatchFailed: 0,
        emailDispatchFailed: 0,
        notificationFailed: 0,
        imageImportFailed: 0,
        rankingFailed: 0,
      },
    },
  });
  expect(JSON.stringify(body)).not.toContain(admin.credentials.email);
  expect(JSON.stringify(body)).not.toContain(stack.env.STORAGE_ROOT);
  expect(body.data.observations.queue.status).toBe('ready');
  expect(new Date(body.data.asOf).getTime() - new Date(body.data.windowStart).getTime()).toBe(
    168 * 3_600_000,
  );
});

it('真实发布、待审和私有数据隔离，七天互动按首次时间及正常账号统计', async () => {
  const fixture = await interactionRankingScenario(stack);
  const read = async () => {
    const response = await fixture.admin.http.raw('/api/v1/admin/overview');
    expect(response.status).toBe(200);
    const { data } = AdminOverviewResponseSchema.parse(await response.json());
    if (data.role !== 'admin') throw Error('应为管理员统计');
    return data;
  };
  const initial = await read();
  expect(initial.catalog).toEqual({
    publicPersonas: 4,
    activeUsers: 15,
    newPublicPersonas7d: 2,
    newActiveUsers7d: 3,
    publishedReleases7d: 4,
  });
  expect(initial.interactions).toEqual({ likes7d: 4, favorites7d: 1, comments7d: 0 });
  const pending = await completePersona(fixture.author.http);
  const submitted = await fixture.author.http.write(
    '/api/v1/me/personas/' + pending.id + '/releases',
    {
      version: '1.0.0',
      expectedDraftRevision: pending.revision,
      changelog: '统计待审隔离',
      confirmed: true,
    },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(submitted.status).toBe(200);
  const submission = SubmissionResponseSchema.parse(await submitted.json()).data;
  const comment = await fixture.reader.http.write(
    '/api/v1/personas/' + fixture.mai.id + '/comments',
    { body: '未审核的评论不得进入公开互动' },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(comment.status).toBe(200);
  const commentRow = CommentResponseSchema.parse(await comment.json()).data;
  expect(
    (
      await fixture.reader.http.write(
        '/api/v1/reports',
        {
          target: { type: 'persona', personaId: fixture.mai.id },
          reason: 'other',
          details: '受控测试的私有举报说明',
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await fixture.author.http.write(
        '/api/v1/me/profile',
        {
          expectedRevision: 0,
          content: {
            displayName: '待审核资料',
            bio: '未审核的私有简介',
            avatarAssetId: null,
            links: [],
          },
        },
        'PUT',
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await fixture.author.http.write(
        '/api/v1/me/profile/submissions',
        { expectedDraftRevision: 1, confirmed: true },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  const pendingResult = await read();
  expect(pendingResult.queues).toEqual({ releases: 1, comments: 1, profiles: 1, reports: 1 });
  expect(pendingResult.catalog).toEqual(initial.catalog);
  expect(pendingResult.interactions).toEqual(initial.interactions);
  expect(JSON.stringify(pendingResult)).not.toContain(submission.id);
  expect(JSON.stringify(pendingResult)).not.toContain('受控测试的私有举报说明');
  expect(
    (
      await fixture.admin.http.write(
        '/api/v1/admin/comments/' + commentRow.id + '/review',
        {
          revisionId: commentRow.latest.id,
          expectedRevision: commentRow.revision,
          decision: 'approve',
          reason: '',
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  expect((await read()).interactions.comments7d).toBe(1);
  await stack.owner.pool.query("UPDATE users SET status='banned' WHERE id=$1", [
    fixture.actor(10).id,
  ]);
  await stack.owner.pool.query('UPDATE users SET email_verified_at=NULL WHERE id=$1', [
    fixture.actor(11).id,
  ]);
  expect((await read()).interactions.likes7d).toBe(2);
  await stack.owner.pool.query("UPDATE personas SET owner_visibility='hidden' WHERE id=$1", [
    fixture.mai.id,
  ]);
  const hidden = await read();
  expect(hidden.catalog.publicPersonas).toBe(3);
  expect(hidden.interactions).toEqual({ likes7d: 1, favorites7d: 0, comments7d: 0 });
});

it('已绑定与未绑定MFA的管理员读取概览都不追加近期验证，换号头不能越权', async () => {
  const admin = await stack.admin();
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET mfa_verified_at=now()-interval '11 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
    [admin.credentials.username],
  );
  expect((await admin.http.raw('/api/v1/admin/overview')).status).toBe(200);
  expect(
    (
      await admin.http.raw('/api/v1/admin/overview', {
        headers: { 'X-Expected-Account': randomUUID() },
      })
    ).status,
  ).toBe(409);
  const username = 'plain_' + randomUUID().slice(0, 8),
    password = 'An unbound admin fixture password 2026';
  await createAdministrator(stack.owner, {
    username,
    password,
    email: username + '@fixture.invalid',
  });
  const plain = stack.browser();
  expect((await plain.write('/api/v1/auth/login', { identifier: username, password })).status).toBe(
    200,
  );
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET created_at=now()-interval '11 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
    [username],
  );
  expect((await plain.raw('/api/v1/admin/overview')).status).toBe(200);
});

it('真实分发耗尽与队列计数各自准确，观测不返回payload或连接信息', async () => {
  const admin = await stack.admin();
  await stack.owner.pool.query(
    "INSERT INTO outbox_events(topic,payload,attempts,last_error_code) VALUES ('auth.email','{\"private\":\"must-not-leak\"}',5,'DELIVERY_FAILED'),('system.probe','{}',5,'DELIVERY_FAILED'),('auth.email','{}',4,'DELIVERY_FAILED')",
  );
  const response = await admin.http.raw('/api/v1/admin/overview');
  expect(response.status).toBe(200);
  const { data } = AdminOverviewResponseSchema.parse(await response.json());
  if (data.role !== 'admin') throw Error('应为管理员统计');
  expect(data.tasks.dispatchFailed).toBe(2);
  expect(data.tasks.emailDispatchFailed).toBe(1);
  expect(JSON.stringify(data)).not.toContain('must-not-leak');
  expect(JSON.stringify(data)).not.toContain(stack.env.REDIS_URL);
  expect(await inspectQueueUsage(stack.env.REDIS_URL, stack.env.QUEUE_NAME)).toMatchObject({
    status: 'ready',
    failed: 0,
    waiting: 0,
    active: 0,
    delayed: 0,
  });
  const queue = createSystemQueue(stack.env.REDIS_URL, stack.env.QUEUE_NAME);
  try {
    await queue.waitUntilReady();
    await queue.add(
      'unsupported.fixture',
      { schemaVersion: 1, eventId: randomUUID() },
      { attempts: 1, jobId: randomUUID() },
    );
    await expect.poll(async () => (await queue.getJobCounts('failed'))['failed']).toBe(1);
    expect(await inspectQueueUsage(stack.env.REDIS_URL, stack.env.QUEUE_NAME)).toMatchObject({
      status: 'ready',
      failed: 1,
    });
  } finally {
    await queue.close();
  }
});

it('请求开始后并发撤权也不能利用旧身份读取管理统计', async () => {
  const admin = await stack.admin();
  await stack.admin();
  const blocker = await stack.owner.pool.connect();
  let committed = false;
  try {
    await blocker.query('BEGIN');
    await blocker.query("UPDATE users SET role='user' WHERE username=$1", [
      admin.credentials.username,
    ]);
    const reply = admin.http.raw('/api/v1/admin/overview');
    await expect
      .poll(async () =>
        Number(
          (
            await stack.owner.pool.query<{ count: string }>(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query ILIKE '%for no key update%'",
            )
          ).rows[0]?.count ?? 0,
        ),
      )
      .toBeGreaterThan(0);
    await blocker.query('COMMIT');
    committed = true;
    expect((await reply).status).toBe(401);
  } finally {
    if (!committed) await blocker.query('ROLLBACK');
    blocker.release();
  }
});

it('概览在实际角色撤销后立即停止返回系统统计', async () => {
  const admin = await stack.admin();
  await stack.admin();
  expect((await admin.http.raw('/api/v1/admin/overview')).status).toBe(200);
  await stack.owner.pool.query("UPDATE users SET role='user' WHERE username=$1", [
    admin.credentials.username,
  ]);
  // 角色变更触发数据库会话撤销，比继续保留账号身份后403更早阻断
  expect((await admin.http.raw('/api/v1/admin/overview')).status).toBe(401);
});
