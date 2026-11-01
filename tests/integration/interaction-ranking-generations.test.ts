import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { outboxEvents } from '@personamarket/database';
import { RANKING_REFRESH_MS, RankingListResponseSchema } from '@personamarket/contracts';
import { buildRankingGeneration, enqueueRankingRefresh } from '@personamarket/server';
import { createAuthStack } from '../fixtures/auth-stack.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});

async function completed(id: string) {
  await stack.tick();
  await expect
    .poll(
      async () =>
        (
          await stack.owner.pool.query<{ status: string }>(
            'SELECT status FROM ranking_generations WHERE id=$1',
            [id],
          )
        ).rows[0]?.status,
      { timeout: 5000, interval: 100 },
    )
    .toBe('completed');
}
async function legacyGeneration() {
  const id = randomUUID();
  await stack.owner.pool.query(
    "INSERT INTO ranking_generations(id,request_key,algorithm) VALUES($1,$2,'exports-v1')",
    [id, 'legacy-task:' + randomUUID()],
  );
  await stack.owner.db
    .insert(outboxEvents)
    .values({ topic: 'rankings.refresh', payload: { generationId: id } });
  await completed(id);
  return id;
}
async function read(query = '') {
  const response = await stack.browser().raw('/api/v1/rankings' + (query ? '?' + query : ''));
  expect(response.status).toBe(200);
  return RankingListResponseSchema.parse(await response.json());
}

it('新互动批次经真实Outbox和Worker原子发布36块空榜，支持新增窗口且重复消费不增加记录', async () => {
  const id = await enqueueRankingRefresh(stack.owner, 'manual');
  if (!id) throw Error('未生成实际重建请求');
  await completed(id);
  const count = () =>
    stack.owner.pool.query<{ total: number }>(
      'SELECT count(*)::int AS total FROM ranking_boards WHERE generation_id=$1',
      [id],
    );
  expect((await count()).rows).toEqual([{ total: 36 }]);
  for (const kind of ['likes', 'favorites'])
    for (const window of ['7d', '30d', 'all']) {
      const response = await read(`kind=${kind}&window=${window}&snapshotId=${id}`);
      expect(response.meta).toMatchObject({
        snapshotId: id,
        algorithm: 'interactions-v1',
        kind,
        window,
        total: 0,
        limited: false,
      });
      expect(response.data).toEqual([]);
    }
  const event = (
    await stack.owner.pool.query<{ id: string }>(
      "SELECT id FROM outbox_events WHERE topic='rankings.refresh' AND payload->>'generationId'=$1",
      [id],
    )
  ).rows[0];
  if (!event) throw Error('缺少实际Outbox事件');
  expect(await buildRankingGeneration(stack.owner, id, event.id)).toBe(false);
  expect((await count()).rows).toEqual([{ total: 36 }]);
});

it('旧算法排队任务继续生成18板，旧快照可读并回退，新批次优先于后来完成的旧任务', async () => {
  const legacy = await legacyGeneration();
  expect(
    (
      await stack.owner.pool.query(
        'SELECT count(*)::int AS total FROM ranking_boards WHERE generation_id=$1',
        [legacy],
      )
    ).rows,
  ).toEqual([{ total: 18 }]);
  expect((await read('snapshotId=' + legacy)).meta).toMatchObject({
    snapshotId: legacy,
    algorithm: 'exports-v1',
  });
  expect((await read()).meta).toMatchObject({ snapshotId: legacy, algorithm: 'exports-v1' });
  expect((await stack.browser().raw('/api/v1/rankings?kind=likes&window=7d')).status).toBe(503);
  const current = await enqueueRankingRefresh(stack.owner, 'manual');
  if (!current) throw Error('缺少新版实际重建请求');
  expect((await read()).meta.snapshotId).toBe(legacy);
  await completed(current);
  const lateLegacy = await legacyGeneration();
  expect((await read()).meta).toMatchObject({ snapshotId: current, algorithm: 'interactions-v1' });
  expect((await read('snapshotId=' + lateLegacy)).meta).toMatchObject({
    snapshotId: lateLegacy,
    algorithm: 'exports-v1',
  });
});

it('新算法的定时去重命名空间与同窗口旧请求隔离，避免升级后等待下一个周期', async () => {
  const at = (await stack.owner.pool.query<{ at: Date }>('SELECT clock_timestamp() AS at')).rows[0]
    ?.at;
  if (!at) throw Error('缺少数据库实际时钟');
  const slot = Math.floor(at.getTime() / RANKING_REFRESH_MS) * RANKING_REFRESH_MS;
  const legacyIds = [randomUUID(), randomUUID()];
  for (const [index, id] of legacyIds.entries())
    await stack.owner.pool.query(
      "INSERT INTO ranking_generations(id,request_key,algorithm) VALUES($1,$2,'exports-v1')",
      [id, 'scheduled:' + new Date(slot + index * RANKING_REFRESH_MS).toISOString()],
    );
  const requested = await Promise.all([
    enqueueRankingRefresh(stack.owner),
    enqueueRankingRefresh(stack.owner),
  ]);
  const ids = requested.filter((id): id is string => id !== null);
  expect(ids.length).toBeGreaterThanOrEqual(1);
  for (const id of ids) {
    expect(legacyIds).not.toContain(id);
    const row = (
      await stack.owner.pool.query<{ request_key: string; algorithm: string }>(
        'SELECT request_key,algorithm FROM ranking_generations WHERE id=$1',
        [id],
      )
    ).rows[0];
    expect(row?.algorithm).toBe('interactions-v1');
    expect(row?.request_key).toContain('scheduled:interactions-v1:');
  }
});
