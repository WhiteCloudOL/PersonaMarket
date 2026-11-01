import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { AdminOverviewResponseSchema } from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { interactionRankingScenario } from '../fixtures/interaction-ranking-scenario.js';
import { seedSearchLoad } from '../fixtures/search-load.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
let admin: Awaited<ReturnType<typeof interactionRankingScenario>>['admin'];
beforeAll(async () => {
  stack = await createAuthStack();
  const fixture = await interactionRankingScenario(stack);
  admin = fixture.admin;
  const client = await stack.owner.pool.connect();
  try {
    // 与搜索/排行容量夹具一致，分批提交完整受约束数据；最终仍验10004条及原API预算。
    for (let batch = 0; batch < 10; batch++) await seedSearchLoad(client, fixture.mai.id, 1000);
  } finally {
    client.release();
  }
}, 60_000); // 仅建库/真实发布基准和万条受控SQL历史夹具，API继续遵守原3秒SQL预算
afterAll(async () => {
  await stack?.close();
});

it('万条公开作品的管理员聚合保持准确并在受限API预算内返回', async () => {
  const measurements: number[] = [];
  for (let index = 0; index < 2; index++) {
    const started = performance.now();
    const response = await admin.http.raw('/api/v1/admin/overview');
    expect(response.status).toBe(200);
    const { data } = AdminOverviewResponseSchema.parse(await response.json());
    measurements.push(Math.round(performance.now() - started));
    if (data.role !== 'admin') throw Error('应返回管理员统计');
    expect(data.catalog.publicPersonas).toBe(10_004);
    expect(data.catalog.publishedReleases7d).toBe(10_004);
    expect(data.interactions).toEqual({ likes7d: 4, favorites7d: 1, comments7d: 0 });
  }
  await mkdir('data/tests/admin-overview', { recursive: true });
  await writeFile(
    'data/tests/admin-overview/capacity.json',
    JSON.stringify(
      {
        publicPersonas: 10_004,
        measurements,
        httpBudgetMilliseconds: 2500,
        statementTimeoutMilliseconds: 3000,
      },
      null,
      2,
    ),
  );
  for (const elapsed of measurements) expect(elapsed).toBeLessThan(2500);
});
