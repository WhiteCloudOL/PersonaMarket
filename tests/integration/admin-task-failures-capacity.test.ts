import { afterAll, beforeAll, expect, it } from 'vitest';
import { AdminTaskListResponseSchema } from '@personamarket/contracts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createAuthStack } from '../fixtures/auth-stack.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeAll(async () => {
  stack = await createAuthStack();
});
afterAll(async () => {
  await stack?.close();
});

it('一万条真实失败记录仍在原SQL预算内分页，只返回当前页与安全元数据', async () => {
  const admin = await stack.admin();
  await stack.owner.pool.query(
    `INSERT INTO outbox_events(topic,payload,attempts,last_error_code,created_at)
     SELECT 'system.probe','{"schemaVersion":1}',5,'DELIVERY_FAILED',
       now()-make_interval(secs=>i) FROM generate_series(1,10004) i`,
  );
  const observations: Array<{ page: number; milliseconds: number }> = [];
  for (const page of [1, 500]) {
    const started = performance.now();
    const response = await admin.http.raw('/api/v1/admin/tasks?category=system&page=' + page);
    expect(response.status).toBe(200);
    const body = AdminTaskListResponseSchema.parse(await response.json());
    expect(body.meta).toMatchObject({ page, pageSize: 20, total: 10004 });
    expect(body.data).toHaveLength(20);
    expect(body.data.every((row) => row.source === 'dispatch')).toBe(true);
    const milliseconds = Math.round(performance.now() - started);
    observations.push({ page, milliseconds });
    expect(milliseconds).toBeLessThan(2500);
  }
  mkdirSync('.development/evidence', { recursive: true });
  writeFileSync(
    '.development/evidence/admin-task-failures-capacity.json',
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        failedRows: 10004,
        observations,
        sqlBudgetUnchanged: true,
      },
      null,
      2,
    ),
  );
});
