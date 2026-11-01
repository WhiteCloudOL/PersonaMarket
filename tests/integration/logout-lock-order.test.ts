import { afterEach, beforeEach, expect, it } from 'vitest';
import { AuthSessionsResponseSchema } from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator } from '../fixtures/creator.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});

it.each(['current', 'device'] as const)(
  '退出或撤销指定会话先锁账号，避免与账号处置形成反向锁：%s',
  async (kind) => {
    const creator = await verifiedCreator(stack);
    const target = (await creator.http.context()).data.account;
    if (!target) throw new Error('测试用户未登录');
    const other = stack.browser();
    let sessionId: string | undefined;
    if (kind === 'device') {
      expect(
        (
          await other.write('/api/v1/auth/login', {
            identifier: creator.username,
            password: creator.password,
          })
        ).status,
      ).toBe(200);
      sessionId = AuthSessionsResponseSchema.parse(
        await (await other.raw('/api/v1/auth/sessions')).json(),
      ).data.find((session) => session.current)?.id;
      if (!sessionId) throw new Error('测试设备会话不存在');
    }
    const blocker = await stack.owner.pool.connect();
    let pending: Promise<Response> | undefined;
    let response: Response | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [target.id]);
      pending = sessionId
        ? creator.http.write('/api/v1/auth/sessions/' + sessionId, undefined, 'DELETE')
        : creator.http.write('/api/v1/auth/logout');
      await expect
        .poll(
          async () => {
            const waiters = await stack.owner.pool.query<{ count: number }>(
              "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'",
            );
            return waiters.rows[0]?.count ?? 0;
          },
          { timeout: 2000, interval: 50 },
        )
        .toBeGreaterThan(0);
      const sessions = await blocker.query<{ id: string }>(
        'SELECT id FROM auth_sessions WHERE user_id=$1 ORDER BY id FOR UPDATE NOWAIT',
        [target.id],
      );
      expect(sessions.rowCount).toBeGreaterThan(0);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      if (pending) {
        response = await pending;
        await response.arrayBuffer();
      }
    }
    expect(response?.status).toBe(200);
    expect((await creator.http.raw('/api/v1/auth/sessions')).status).toBe(
      kind === 'current' ? 401 : 200,
    );
    if (kind === 'device') expect((await other.raw('/api/v1/auth/sessions')).status).toBe(401);
  },
);
