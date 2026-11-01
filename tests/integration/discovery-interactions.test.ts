import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  DraftResponseSchema,
  PublicPersonaListResponseSchema,
  RankingListResponseSchema,
} from '@personamarket/contracts';
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

it('探索提供实际有效点赞和收藏排序，与同一时刻总榜相符并区分展示总数和非本人排行数量', async () => {
  const fixture = await interactionRankingScenario(stack);
  const at = (await stack.owner.pool.query<{ at: Date }>('SELECT clock_timestamp() AS at')).rows[0]
    ?.at;
  if (!at) throw Error('缺少探索互动核对时刻');
  expect(at.getTime()).toBeGreaterThan(fixture.at.getTime() + 1);
  const snapshot = await rankingSnapshotAt(stack, at);
  const fixtureIds = new Set<string>([fixture.mai.id, fixture.astr.id]);
  for (const kind of ['likes', 'favorites'] as const) {
    const response = await stack.browser().raw('/api/v1/personas?sort=' + kind);
    expect(response.status).toBe(200);
    const list = PublicPersonaListResponseSchema.parse(await response.json());
    const boardReply = await stack
      .browser()
      .raw('/api/v1/rankings?kind=' + kind + '&window=all&snapshotId=' + snapshot);
    expect(boardReply.status).toBe(200);
    const board = RankingListResponseSchema.parse(await boardReply.json());
    expect(list.data.slice(0, 2).map((row) => row.personaId)).toEqual(
      board.data.map((row) => row.personaId),
    );
    for (const entry of board.data) {
      const card = list.data.find((row) => row.personaId === entry.personaId);
      expect(card?.interactionMetric).toEqual({ kind, eligibleCount: entry.score });
      // 原展示总数按active关系计数；夹具中的未来关系仍保留原展示语义，排序额外排除
      const displayed = kind === 'likes' ? 5 : entry.personaId === fixture.mai.id ? 5 : 4;
      expect(card?.interactionCounts[kind]).toBe(displayed);
      expect(card?.interactionCounts[kind]).toBeGreaterThan(entry.score);
    }
    expect(
      list.data
        .filter((row) => !fixtureIds.has(row.personaId))
        .every((row) => row.interactionMetric?.eligibleCount === 0),
    ).toBe(true);
    for (const actor of fixture.actors) {
      expect(JSON.stringify(list)).not.toContain(actor.id);
      expect(JSON.stringify(list)).not.toContain(actor.username);
    }
  }
});

it('互动排序与搜索都即时排除下架作品，私有草稿不进入筛选、数量和返回卡片', async () => {
  const fixture = await interactionRankingScenario(stack),
    title = '排序隔离私有草稿星河';
  const created = await fixture.author.http.write('/api/v1/me/personas', {
    platform: 'maibot',
    title,
  });
  expect(created.status).toBe(200);
  const draft = DraftResponseSchema.parse(await created.json()).data;
  expect(
    (
      await moderatePersona(fixture.admin.http, fixture.mai.id, {
        state: 'blocked',
        reason: '核对探索互动排序即时下架',
      })
    ).status,
  ).toBe(200);
  for (const kind of ['likes', 'favorites'] as const) {
    const response = await stack.browser().raw('/api/v1/personas?sort=' + kind);
    expect(response.status).toBe(200);
    const list = PublicPersonaListResponseSchema.parse(await response.json());
    const ids = list.data.map((row) => row.personaId);
    expect(ids).not.toContain(fixture.mai.id);
    expect(ids).not.toContain(draft.id);
    expect(ids).toContain(fixture.astr.id);
    const filtered = await stack
      .browser()
      .raw('/api/v1/personas?' + new URLSearchParams({ sort: kind, q: title }));
    expect(filtered.status).toBe(200);
    expect(PublicPersonaListResponseSchema.parse(await filtered.json())).toMatchObject({
      data: [],
      meta: { total: 0 },
    });
  }
});
