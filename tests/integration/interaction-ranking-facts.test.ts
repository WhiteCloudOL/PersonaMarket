import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  RankingListResponseSchema,
  PublicPersonaListResponseSchema,
  type RankingKind,
  type RankingWindow,
} from '@personamarket/contracts';
import { interactionWindowCondition } from '@personamarket/server';
import { createAuthStack } from '../fixtures/auth-stack.js';
import {
  interactionRankingScenario,
  rankingSnapshotAt,
} from '../fixtures/interaction-ranking-scenario.js';
import { moderatePersona } from '../fixtures/admin-persona-moderation.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});
async function read(id: string, kind: RankingKind, window: RankingWindow, platform = 'all') {
  const response = await stack
    .browser()
    .raw(`/api/v1/rankings?snapshotId=${id}&kind=${kind}&window=${window}&platform=${platform}`);
  expect(response.status).toBe(200);
  return RankingListResponseSchema.parse(await response.json());
}

it('实际导出和关系按3/4/1衰减，7/30/总榜排除本人、取消与未来，毫秒边界和两平台正确', async () => {
  const fixture = await interactionRankingScenario(stack);
  const current = await rankingSnapshotAt(stack, fixture.at),
    legacy = await rankingSnapshotAt(stack, fixture.at, 'exports-v1');
  const hot = await read(current, 'hot', '7d');
  expect(hot.data.map((row) => row.personaId)).toEqual([fixture.astr.id, fixture.mai.id]);
  const mai = hot.data.find((row) => row.personaId === fixture.mai.id),
    astr = hot.data.find((row) => row.personaId === fixture.astr.id);
  expect(mai).toMatchObject({ eligibleExports: 1, eligibleLikes: 1, eligibleFavorites: 1 });
  expect(astr).toMatchObject({ eligibleExports: 0, eligibleLikes: 2, eligibleFavorites: 1 });
  const exportAge = fixture.at.getTime() - fixture.exportAt.getTime();
  expect(mai?.score).toBeCloseTo(
    3 * 2 ** (-1 / 7) + 4 * 2 ** (-2 / 7) + 2 ** (-exportAge / 604_800_000),
    6,
  );
  expect(astr?.score).toBeCloseTo(3 * (2 ** -0.5 + 1) + 4 * 0.5, 6);
  for (const [kind, windows] of [
    ['likes', { '7d': [1, 2], '30d': [2, 3], all: [3, 3] }],
    ['favorites', { '7d': [1, 1], '30d': [2, 2], all: [3, 3] }],
  ] as const)
    for (const window of ['7d', '30d', 'all'] as const) {
      const rows = (await read(current, kind, window)).data;
      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.personaId === fixture.mai.id)?.score).toBe(windows[window][0]);
      expect(rows.find((row) => row.personaId === fixture.astr.id)?.score).toBe(windows[window][1]);
      const encoded = JSON.stringify(rows);
      for (const actor of fixture.actors) {
        expect(encoded).not.toContain(actor.id);
        expect(encoded).not.toContain(actor.username);
      }
    }
  expect((await read(current, 'likes', '7d', 'maibot')).data.map((row) => row.personaId)).toEqual([
    fixture.mai.id,
  ]);
  expect((await read(current, 'likes', '7d', 'astrbot')).data.map((row) => row.personaId)).toEqual([
    fixture.astr.id,
  ]);
  expect((await read(legacy, 'hot', '7d')).data.map((row) => row.personaId)).toEqual([
    fixture.mai.id,
  ]);
  const common = (id: string) =>
    stack.owner.pool.query(
      `SELECT kind,"window",platform,position,persona_id,release_id,score,eligible_exports FROM ranking_entries WHERE generation_id=$1 AND kind IN ('downloads','new','updated') ORDER BY kind,"window",platform,position`,
      [id],
    );
  expect((await common(current)).rows).toEqual((await common(legacy)).rows);
});

it('历史关系经真实登录取消重加仍在原窗口，重建不会将旧互动刷新成新增', async () => {
  const fixture = await interactionRankingScenario(stack),
    actor = fixture.actor(2),
    http = stack.browser();
  expect(
    (
      await http.write('/api/v1/auth/login', {
        identifier: actor.username,
        password: fixture.reader.password,
      })
    ).status,
  ).toBe(200);
  for (const kind of ['like', 'favorite']) {
    expect(
      (await http.write('/api/v1/personas/' + fixture.mai.id + '/' + kind, undefined, 'DELETE'))
        .status,
    ).toBe(200);
    expect(
      (await http.write('/api/v1/personas/' + fixture.mai.id + '/' + kind, {}, 'PUT')).status,
    ).toBe(200);
  }
  for (const table of ['persona_likes', 'persona_favorites'])
    expect(
      (
        await stack.owner.pool.query<{ first_added_at: Date }>(
          'SELECT first_added_at FROM ' + table + ' WHERE user_id=$1 AND persona_id=$2',
          [actor.id, fixture.mai.id],
        )
      ).rows[0]?.first_added_at,
    ).toEqual(new Date(fixture.at.getTime() - 40 * 86_400_000));
  const at = (await stack.owner.pool.query<{ at: Date }>('SELECT clock_timestamp() AS at')).rows[0]
    ?.at;
  if (!at) throw Error('缺少重建时刻');
  const rebuilt = await rankingSnapshotAt(stack, at);
  for (const kind of ['likes', 'favorites'] as const)
    for (const [window, expected] of [
      ['7d', 1],
      ['30d', 2],
      ['all', 3],
    ] as const)
      expect(
        (await read(rebuilt, kind, window)).data.find((row) => row.personaId === fixture.mai.id)
          ?.score,
      ).toBe(expected);
});

it('旧互动快照读取即时排除管理员下架作品，搜索与新增榜板均无私有内容', async () => {
  const fixture = await interactionRankingScenario(stack),
    id = await rankingSnapshotAt(stack, fixture.at);
  expect(
    (
      await moderatePersona(fixture.admin.http, fixture.mai.id, {
        state: 'blocked',
        reason: '核对互动榜下架隔离',
      })
    ).status,
  ).toBe(200);
  for (const [kind, window] of [
    ['hot', '7d'],
    ['likes', 'all'],
    ['favorites', 'all'],
  ] as const) {
    const response = await read(id, kind, window);
    expect(response.data.map((row) => row.personaId)).toEqual([fixture.astr.id]);
    expect(response.data[0]?.position).toBe(1);
    expect(response.meta.total).toBe(1);
  }
  const response = await stack.browser().raw('/api/v1/personas?sort=hot');
  expect(response.status).toBe(200);
  const results = PublicPersonaListResponseSchema.parse(await response.json());
  expect(results.data.map((row) => row.personaId)).not.toContain(fixture.mai.id);
  expect(results.data.map((row) => row.personaId)).toContain(fixture.astr.id);
});

it('探索热度与同一时刻的互动榜按相同资格、计数和3/4/1权重排序，不泄漏互动者', async () => {
  const fixture = await interactionRankingScenario(stack);
  for (const kind of ['like', 'favorite'])
    expect(
      (
        await fixture.reader.http.write(
          '/api/v1/personas/' + fixture.astr.id + '/' + kind,
          {},
          'PUT',
        )
      ).status,
    ).toBe(200);
  const at = (await stack.owner.pool.query<{ at: Date }>('SELECT clock_timestamp() AS at')).rows[0]
    ?.at;
  if (!at) throw Error('缺少探索核对时刻');
  expect(at.getTime()).toBeGreaterThan(fixture.at.getTime() + 1);
  const snapshot = await read(await rankingSnapshotAt(stack, at), 'hot', '7d');
  const response = await stack.browser().raw('/api/v1/personas?sort=hot');
  expect(response.status).toBe(200);
  const results = PublicPersonaListResponseSchema.parse(await response.json());
  const ids: readonly string[] = [fixture.mai.id, fixture.astr.id];
  const cards = results.data.filter((row) => ids.includes(row.personaId));
  expect(snapshot.data[0]?.personaId).toBe(fixture.astr.id);
  expect(cards.map((row) => row.personaId)).toEqual(snapshot.data.map((row) => row.personaId));
  for (const card of cards) {
    const entry = snapshot.data.find((row) => row.personaId === card.personaId);
    if (!entry) throw Error('缺少对应排行事实');
    expect(card.heatMetric).toMatchObject({
      algorithm: 'interactions-v1',
      eligibleExports: entry.eligibleExports,
      eligibleLikes: entry.eligibleLikes,
      eligibleFavorites: entry.eligibleFavorites,
    });
    // 探索使用实际请求时刻，短暂请求间隔只影响指数衰减，不改变这组窗口资格
    expect(card.heatMetric?.score).toBeCloseTo(entry.score, 4);
  }
  const encoded = JSON.stringify(results);
  for (const actor of fixture.actors) {
    expect(encoded).not.toContain(actor.id);
    expect(encoded).not.toContain(actor.username);
  }
});

it('滚动7/30日毫秒上下界在UTC、夏令时和上海时区一致', async () => {
  const cutoff = new Date('2026-11-03T12:00:00.000Z');
  for (const zone of ['UTC', 'America/New_York', 'Asia/Shanghai'])
    for (const days of [7, 30] as const) {
      const lower = cutoff.getTime() - days * 86_400_000;
      const inputs = [lower - 1, lower, lower + 1, cutoff.getTime(), cutoff.getTime() + 1];
      const rows = await stack.owner.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('TimeZone',${zone},true)`);
        const values = sql.join(
          inputs.map(
            (first, index) => sql`(${index}::int,${new Date(first).toISOString()}::timestamptz)`,
          ),
          sql`, `,
        );
        return tx.execute<{ inside: boolean }>(
          sql`SELECT ${interactionWindowCondition(sql`${cutoff.toISOString()}::timestamptz`, sql`i.first_added_at`, days)} AS inside FROM (VALUES ${values}) i(position,first_added_at) ORDER BY i.position`,
        );
      });
      expect(
        rows.rows.map((row) => row.inside),
        zone + '/' + days,
      ).toEqual([false, true, true, true, false]);
    }
});
