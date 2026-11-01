import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  AuthContextResponseSchema,
  ErrorResponseSchema,
  PublicConfigResponseSchema,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});

for (const path of ['/api/v1/public/config', '/api/v1/auth/context'])
  it('隔离数据库连接中断返回可重试503并恢复：' + path, async () => {
    const database = await stack.owner.pool.query<{ name: string }>(
      'SELECT current_database() AS name',
    );
    if (!/^pm_auth_case_[a-f0-9]{32}_test$/.test(database.rows[0]?.name ?? ''))
      throw new Error('连接中断测试仅允许本次新建的隔离数据库');
    const blocker = await stack.owner.pool.connect();
    const http = stack.browser();
    let pending: Promise<Response> | undefined;
    let blockedPid: number | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('LOCK TABLE site_settings IN ACCESS EXCLUSIVE MODE');
      pending = http.raw(path);
      await expect
        .poll(async () => {
          const result = await stack.owner.pool.query<{ pid: number }>(
            "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name='personamarket' AND wait_event_type='Lock' AND query LIKE '%site_settings%' ORDER BY query_start LIMIT 1",
          );
          blockedPid = result.rows[0]?.pid;
          return blockedPid;
        })
        .toBeGreaterThan(0);
      const terminated = await stack.owner.pool.query<{ terminated: boolean }>(
        "SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity WHERE pid=$1 AND datname=current_database() AND datname LIKE '%_test' AND application_name='personamarket' AND wait_event_type='Lock'",
        [blockedPid],
      );
      expect(terminated.rows[0]?.terminated).toBe(true);
      const failed = await pending;
      expect(failed.status).toBe(503);
      expect(failed.headers.get('retry-after')).toBe('1');
      const error = ErrorResponseSchema.parse(await failed.json());
      expect(error.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(JSON.stringify(error)).not.toMatch(
        /site_settings|SELECT|postgres|terminating|password/,
      );
      await blocker.query('ROLLBACK');
      const recovered = await http.raw(path);
      expect(recovered.status).toBe(200);
      if (path.endsWith('/config'))
        expect(PublicConfigResponseSchema.parse(await recovered.json()).data.name).not.toBe('');
      else
        expect(AuthContextResponseSchema.parse(await recovered.json()).data.assurance).toBe(
          'anonymous',
        );
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await pending;
    }
  });
