import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  AdminUserResponseSchema,
  AuthContextResponseSchema,
  ErrorResponseSchema,
} from '@personamarket/contracts';
import { createAdministrator } from '@personamarket/server';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator } from '../fixtures/creator.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});

async function administrator() {
  const username = 'guard_' + randomUUID().replaceAll('-', '').slice(0, 12);
  const credentials = {
    username,
    email: username + '@fixture.invalid',
    password: 'Protected administrator fixture passphrase 2026',
  };
  await createAdministrator(stack.owner, credentials);
  const http = stack.browser();
  expect(
    (
      await http.write('/api/v1/auth/login', {
        identifier: username,
        password: credentials.password,
      })
    ).status,
  ).toBe(200);
  const account = AuthContextResponseSchema.parse(
    await (await http.raw('/api/v1/auth/context')).json(),
  ).data.account;
  if (!account) throw new Error('测试管理员未登录');
  return { http, account };
}

it('最后一个有效管理员不能封禁或降级自身，失败不留下管理成功记录', async () => {
  const admin = await administrator();
  for (const [suffix, input] of [
    ['role', { role: 'user' }],
    ['status', { status: 'banned' }],
  ] as const) {
    const response = await admin.http.write(
      '/api/v1/admin/users/' + admin.account.id + '/' + suffix,
      { ...input, expectedSecurityVersion: 1, reason: '验证最后管理员保护' },
      'PUT',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(response.status).toBe(409);
    expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe('CONFLICT');
  }
  const remaining = await stack.owner.pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM users WHERE role='admin' AND status='active'",
  );
  expect(remaining.rows[0]?.count).toBe(1);
  expect(
    (
      await stack.owner.pool.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM user_management_records',
      )
    ).rows[0]?.count,
  ).toBe(0);
});

it('两位管理员并发降级自身，只能成功一项且保留一个有效管理员', async () => {
  const admins = [await administrator(), await administrator()];
  const responses = await Promise.all(
    admins.map((admin) =>
      admin.http.write(
        '/api/v1/admin/users/' + admin.account.id + '/role',
        { role: 'user', expectedSecurityVersion: 1, reason: '并发核对管理员保护' },
        'PUT',
        { 'Idempotency-Key': randomUUID() },
      ),
    ),
  );
  expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  const state = await stack.owner.pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM users WHERE role='admin' AND status='active'",
  );
  expect(state.rows[0]?.count).toBe(1);
  expect(
    (
      await stack.owner.pool.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM user_management_records',
      )
    ).rows[0]?.count,
  ).toBe(1);
});

it('交叉封禁不会互等到死锁，已被撤销的管理员不能再执行事务', async () => {
  const first = await administrator();
  const second = await administrator();
  const responses = await Promise.all(
    [
      [first, second],
      [second, first],
    ].map(async ([actor, target]) => {
      if (!actor || !target) throw new Error('并发测试账号不足');
      return actor.http.write(
        '/api/v1/admin/users/' + target.account.id + '/status',
        { status: 'banned', expectedSecurityVersion: 1, reason: '交叉管理员操作验证' },
        'PUT',
        { 'Idempotency-Key': randomUUID() },
      );
    }),
  );
  expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
  const denied = responses.find((response) => response.status !== 200);
  expect(denied?.status).toBe(401);
  const state = await stack.owner.pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM users WHERE role='admin' AND status='active'",
  );
  expect(state.rows[0]?.count).toBe(1);
});

it('管理事务锁有真实超时，失败不落记录或消费幂等键，解除锁后可重试同一操作', async () => {
  const admin = await administrator();
  const creator = await verifiedCreator(stack);
  const target = (await creator.http.context()).data.account;
  if (!target) throw new Error('测试用户未登录');
  const state = AdminUserResponseSchema.parse(
    await (await admin.http.raw('/api/v1/admin/users/' + target.id)).json(),
  ).data;
  const path = '/api/v1/admin/users/' + target.id + '/sessions';
  const input = { expectedSecurityVersion: state.securityVersion, reason: '核对超时后的安全重试' };
  const headers = { 'Idempotency-Key': randomUUID() };
  const blocker = await stack.owner.pool.connect();
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT pg_advisory_xact_lock(1347244619,2)');
    const started = Date.now();
    const response = await admin.http.write(path, input, 'PUT', headers);
    expect(response.status).toBe(503);
    expect(Date.now() - started).toBeLessThan(7000);
    expect(response.headers.get('retry-after')).toBe('1');
    expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe('SERVICE_UNAVAILABLE');
    expect(
      (
        await stack.owner.pool.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM user_management_records',
        )
      ).rows[0]?.count,
    ).toBe(0);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
  const retried = await admin.http.write(path, input, 'PUT', headers);
  expect(retried.status).toBe(200);
  const result = AdminUserResponseSchema.parse(await retried.json()).data;
  expect(result.activeSessionCount).toBe(0);
  expect(result.records).toHaveLength(1);
  expect(result.records[0]?.action).toBe('revoke_sessions');
  expect((await creator.http.raw('/api/v1/auth/sessions')).status).toBe(401);
});

it('等待锁期间近期验证过期，事务内复查阻止写入', async () => {
  const admin = await administrator();
  const creator = await verifiedCreator(stack);
  const target = (await creator.http.context()).data.account;
  if (!target) throw new Error('测试用户未登录');
  const state = AdminUserResponseSchema.parse(
    await (await admin.http.raw('/api/v1/admin/users/' + target.id)).json(),
  ).data;
  const blocker = await stack.owner.pool.connect();
  let pending: Promise<Response> | undefined;
  let response: Response | undefined;
  let observationFailure: { cause: unknown } | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT pg_advisory_xact_lock(1347244619,2)');
    pending = admin.http.write(
      '/api/v1/admin/users/' + target.id + '/role',
      {
        role: 'moderator',
        expectedSecurityVersion: state.securityVersion,
        reason: '核对事务中的真实身份时效',
      },
      'PUT',
      { 'Idempotency-Key': randomUUID() },
    );
    await expect
      .poll(
        async () => {
          const waiters = await stack.owner.pool.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND wait_event='advisory'",
          );
          return waiters.rows[0]?.count ?? 0;
        },
        { timeout: 2000, interval: 50 },
      )
      .toBeGreaterThan(0);
    await stack.owner.pool.query(
      "UPDATE auth_sessions SET created_at=now()-interval '11 minutes' WHERE user_id=$1",
      [admin.account.id],
    );
  } catch (cause) {
    observationFailure = { cause };
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    if (pending) response = await pending;
  }
  if (observationFailure) {
    await response?.arrayBuffer();
    throw observationFailure.cause;
  }
  if (!response) throw new Error('管理请求未创建');
  expect(response.status).toBe(403);
  expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe('REAUTH_REQUIRED');
  const unchanged = AdminUserResponseSchema.parse(
    await (await admin.http.raw('/api/v1/admin/users/' + target.id)).json(),
  ).data;
  expect(unchanged.role).toBe('user');
  expect(unchanged.securityVersion).toBe(state.securityVersion);
  expect(unchanged.records).toHaveLength(0);
});
