import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, it, expect } from 'vitest';
import {
  defaultRankingSettings,
  RankingListResponseSchema,
  RankingSettingsResponseSchema,
  rankingSettingsEtag,
  type RankingSettings,
} from '@personamarket/contracts';
import {
  enqueueConfiguredRankingRefresh,
  enqueueRankingRefresh,
  buildRankingGeneration,
} from '@personamarket/server';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { interactionRankingScenario } from '../fixtures/interaction-ranking-scenario.js';
import type { AuthHttp } from '../fixtures/auth-http.js';
let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});
async function change(http: AuthHttp, revision: number, data: RankingSettings) {
  const result = await http.write(
    '/api/v1/admin/settings/rankings',
    { data, reason: '核对冻结配置与真实榜单' },
    'PATCH',
    { 'If-Match': rankingSettingsEtag(revision), 'Idempotency-Key': randomUUID() },
  );
  expect(result.status).toBe(200);
  return RankingSettingsResponseSchema.parse(await result.json());
}
async function requestFor(revision: number) {
  const row = (
    await stack.owner.pool.query<{ id: string; event_id: string }>(
      "SELECT g.id,e.id AS event_id FROM ranking_generations g JOIN outbox_events e ON e.topic='rankings.refresh' AND e.payload->>'generationId'=g.id::text WHERE settings_revision=$1 ORDER BY requested_at DESC LIMIT 1",
      [revision],
    )
  ).rows[0];
  if (!row) throw Error('缺少真实原子请求');
  return row;
}
async function read(id: string, kind = 'hot', window = '7d') {
  const result = await stack
    .browser()
    .raw(`/api/v1/rankings?snapshotId=${id}&kind=${kind}&window=${window}`);
  expect(result.status).toBe(200);
  return RankingListResponseSchema.parse(await result.json());
}
it('权重、展示上限和可配置新作窗口按冻结批次真实计算，迟到旧修订不替换新结果', async () => {
  const fixture = await interactionRankingScenario(stack);
  const first = {
    ...defaultRankingSettings,
    weights: { likes: 0, favorites: 0, exports: 2 },
    newcomerWindowDays: 365,
    refreshMinutes: 60,
  };
  await change(fixture.admin.http, 1, first);
  const a = await requestFor(2);
  const second = {
    ...defaultRankingSettings,
    weights: { likes: 0, favorites: 0, exports: 0 },
    entryLimit: 1,
    newcomerWindowDays: 1,
    refreshMinutes: 1,
  };
  await change(fixture.admin.http, 2, second);
  const b = await requestFor(3);
  // 真实构建服务故意按B→A消费排队请求，证明旧修订迟到不会覆盖当前修订
  await buildRankingGeneration(stack.owner, b.id, b.event_id);
  await buildRankingGeneration(stack.owner, a.id, a.event_id);
  const hot = await read(a.id);
  expect(hot.meta.definition?.settings).toEqual(first);
  expect(hot.meta.refreshAfter).toBe(
    new Date(new Date(hot.meta.generatedAt).getTime() + 60 * 60_000).toISOString(),
  );
  expect(hot.data.map((row) => row.personaId)).toEqual([fixture.mai.id]);
  expect(hot.data[0]?.score).toBeCloseTo(
    2 *
      2 ** (-(new Date(hot.meta.generatedAt).getTime() - fixture.exportAt.getTime()) / 604800_000),
    6,
  );
  const newcomers = await read(a.id, 'new', 'newcomer');
  expect(newcomers.meta.windowDays).toBe(365);
  expect(newcomers.data.map((row) => row.personaId)).toEqual(
    expect.arrayContaining([fixture.mai.id, fixture.astr.id]),
  );
  const fixed = await read(a.id, 'new', '30d');
  expect(fixed.meta.windowDays).toBe(30);
  expect(fixed.data.map((row) => row.personaId)).not.toContain(fixture.mai.id);
  expect(fixed.data.map((row) => row.personaId)).not.toContain(fixture.astr.id);
  expect((await read(b.id)).data).toEqual([]);
  const bounded = await read(b.id, 'updated', 'all');
  expect(bounded.data).toHaveLength(1);
  expect(bounded.meta).toMatchObject({ entryLimit: 1, total: 1, limited: true });
  expect((await read(b.id, 'likes', 'all')).data.length).toBeGreaterThan(0);
  const current = await stack.browser().raw('/api/v1/rankings');
  expect(RankingListResponseSchema.parse(await current.json()).meta.snapshotId).toBe(b.id);
  const discovery = await stack.browser().raw('/api/v1/personas?sort=hot');
  expect(discovery.status).toBe(200);
  expect(JSON.stringify(await discovery.json())).toContain('interactions-v1');
  const legacy = await enqueueRankingRefresh(stack.owner, 'manual');
  if (!legacy) throw Error('missing v1');
  const event = (
    await stack.owner.pool.query<{ id: string }>(
      "SELECT id FROM outbox_events WHERE payload->>'generationId'=$1",
      [legacy],
    )
  ).rows[0];
  if (!event) throw Error('missing v1 event');
  await buildRankingGeneration(stack.owner, legacy, event.id);
  expect((await read(legacy)).meta).toMatchObject({
    algorithm: 'interactions-v1',
    entryLimit: 1000,
  });
  expect((await read(legacy)).meta.definition).toBeUndefined();
  expect(
    RankingListResponseSchema.parse(await (await stack.browser().raw('/api/v1/rankings')).json())
      .meta.snapshotId,
  ).toBe(b.id);
});
it('真实Worker生成39块榜板，定时请求按配置修订隔离且重复消费不增板', async () => {
  const requests = await Promise.all([
    enqueueConfiguredRankingRefresh(stack.owner),
    enqueueConfiguredRankingRefresh(stack.owner),
  ]);
  const ids = requests.filter((id): id is string => id !== null);
  expect(ids).toHaveLength(1);
  const id = ids[0];
  if (!id) throw Error('missing configured generation');
  await stack.tick();
  await expect
    .poll(
      async () =>
        (await stack.owner.pool.query('SELECT status FROM ranking_generations WHERE id=$1', [id]))
          .rows[0]?.status,
      { timeout: 5000, interval: 100 },
    )
    .toBe('completed');
  expect(
    (
      await stack.owner.pool.query(
        'SELECT count(*)::int AS n FROM ranking_boards WHERE generation_id=$1',
        [id],
      )
    ).rows,
  ).toEqual([{ n: 39 }]);
  const event = (
    await stack.owner.pool.query<{ id: string }>(
      "SELECT id FROM outbox_events WHERE payload->>'generationId'=$1",
      [id],
    )
  ).rows[0];
  if (!event) throw Error('missing event');
  expect(await buildRankingGeneration(stack.owner, id, event.id)).toBe(false);
  expect((await read(id)).meta).toMatchObject({
    algorithm: 'interactions-v2',
    definition: { settingsRevision: 1, settings: defaultRankingSettings },
  });
  const admin = await stack.admin();
  await change(admin.http, 1, { ...defaultRankingSettings, entryLimit: 10 });
  const next = await enqueueConfiguredRankingRefresh(stack.owner);
  expect(next).not.toBeNull();
  expect(next).not.toBe(id);
  const row = (
    await stack.owner.pool.query('SELECT request_key FROM ranking_generations WHERE id=$1', [next])
  ).rows[0];
  expect(row?.request_key).toContain('scheduled:interactions-v2:2:');
});
it('数据库保护冻结定义和算法身份，旧算法不能伪造运营窗口', async () => {
  const id = await enqueueConfiguredRankingRefresh(stack.owner, 'manual');
  if (!id) throw Error('missing generation');
  for (const statement of [
    'UPDATE ranking_generations SET settings_revision=2 WHERE id=$1',
    "UPDATE ranking_generations SET definition=jsonb_set(definition,'{settings,entryLimit}','1'::jsonb) WHERE id=$1",
    "UPDATE ranking_generations SET algorithm='interactions-v1',definition=NULL,settings_revision=NULL WHERE id=$1",
  ])
    await expect(stack.owner.pool.query(statement, [id])).rejects.toMatchObject({ code: '23514' });
  await expect(
    stack.owner.pool.query(
      "INSERT INTO ranking_generations(request_key,algorithm) VALUES($1,'interactions-v2')",
      ['invalid:' + randomUUID()],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  const old = await enqueueRankingRefresh(stack.owner, 'manual');
  await expect(
    stack.owner.pool.query(
      "INSERT INTO ranking_boards(generation_id,kind,\"window\",platform,entry_count,capped) VALUES($1,'new','newcomer','all',0,false)",
      [old],
    ),
  ).rejects.toMatchObject({ code: '23514' });
});
