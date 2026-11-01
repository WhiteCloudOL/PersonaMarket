import { expect, it } from 'vitest';
import {
  RANKING_ALGORITHM,
  RankingListResponseSchema,
  RankingHeatMetricSchema,
  RankingQuerySchema,
} from '@personamarket/contracts';

it('榜单只接受真实指标、适用时间范围和有界页码，拒绝伪造身份与未知排序', () => {
  expect(RankingQuerySchema.parse({})).toEqual({
    kind: 'hot',
    window: '7d',
    platform: 'all',
    page: 1,
    pageSize: 20,
  });
  for (const value of [
    { kind: 'hot', window: 'all' },
    { kind: 'new', window: '7d' },
    { kind: 'updated', window: '30d' },
    { kind: 'likes', window: '365d' },
    { kind: 'favorites', window: 'invalid' },
    { kind: 'downloads', window: 'all', platform: 'sql-injection' },
    { kind: 'downloads', page: 51 },
    { pageSize: 1000 },
    { snapshotId: 'private-or-invalid' },
    { role: 'admin' },
  ])
    expect(RankingQuerySchema.safeParse(value).success).toBe(false);
  for (const window of ['7d', '30d', 'all'])
    expect(
      RankingQuerySchema.safeParse({ kind: 'downloads', window, platform: 'astrbot', page: '2' })
        .success,
    ).toBe(true);
  expect(RankingQuerySchema.safeParse({ kind: 'new', window: '30d' }).success).toBe(true);
  expect(RankingQuerySchema.safeParse({ kind: 'updated', window: 'all' }).success).toBe(true);
});

it('真实点赞榜和收藏榜提供7天、30天与总榜，并保留三种平台和有界分页', () => {
  for (const kind of ['likes', 'favorites'])
    for (const window of ['7d', '30d', 'all'])
      for (const platform of ['all', 'maibot', 'astrbot'])
        expect(
          RankingQuerySchema.safeParse({ kind, window, platform, page: '2', pageSize: 20 }).success,
          `${kind}/${window}/${platform}`,
        ).toBe(true);
});

const emptySnapshot = {
  data: [],
  meta: {
    snapshotId: '11111111-1111-4111-8111-111111111111',
    algorithm: 'exports-v1',
    generatedAt: '2026-10-31T00:00:00.000Z',
    refreshAfter: '2026-10-31T00:05:00.000Z',
    kind: 'hot',
    window: '7d',
    platform: 'all',
    page: 1,
    pageSize: 20,
    total: 0,
    stale: false,
    limited: false,
  },
};

it('公开快照识别新互动算法和旧导出算法，拒绝未知算法或伪造旧版互动榜', () => {
  for (const algorithm of ['exports-v1', 'interactions-v1'])
    expect(
      RankingListResponseSchema.safeParse({
        ...emptySnapshot,
        meta: { ...emptySnapshot.meta, algorithm },
      }).success,
      algorithm,
    ).toBe(true);
  expect(
    RankingListResponseSchema.safeParse({
      ...emptySnapshot,
      meta: { ...emptySnapshot.meta, algorithm: 'unreviewed-v999' },
    }).success,
  ).toBe(false);
  expect(
    RankingListResponseSchema.safeParse({
      ...emptySnapshot,
      meta: { ...emptySnapshot.meta, algorithm: 'exports-v1', kind: 'likes' },
    }).success,
  ).toBe(false);
});

it('新批次使用独立的互动算法版本，不能给新评分沿用旧导出口径标识', () => {
  expect(RANKING_ALGORITHM).toBe('interactions-v1');
});

it('热度响应保留旧导出字段，新版必须提供真实关系数量并拒绝非有限或越界指标', () => {
  const legacy = { algorithm: 'exports-v1', score: 1, eligibleExports: 1 };
  expect(RankingHeatMetricSchema.safeParse(legacy).success).toBe(true);
  expect(RankingHeatMetricSchema.safeParse({ ...legacy, eligibleLikes: 1 }).success).toBe(false);
  const current = {
    ...legacy,
    algorithm: 'interactions-v1',
    eligibleLikes: 2,
    eligibleFavorites: 3,
  };
  expect(RankingHeatMetricSchema.safeParse(current).success).toBe(true);
  expect(
    RankingHeatMetricSchema.safeParse({ ...legacy, algorithm: 'interactions-v1' }).success,
  ).toBe(false);
  for (const invalid of [
    { score: Infinity },
    { score: NaN },
    { eligibleLikes: -1 },
    { eligibleFavorites: Number.MAX_SAFE_INTEGER + 1 },
  ])
    expect(RankingHeatMetricSchema.safeParse({ ...current, ...invalid }).success).toBe(false);
});
