import { expect, it } from 'vitest';
import {
  DEFAULT_RANKING_SETTINGS,
  defaultRankingSettings,
  RankingDefinitionSchema,
  RankingSettingsSchema,
  RankingSettingsWriteSchema,
  RankingSettingsResponseSchema,
  RankingSettingsRecordsQuerySchema,
  RankingSettingsRecordsResponseSchema,
  rankingSettingsEtag,
} from '@personamarket/contracts';

it('排行默认配置保留3/4/1权重、5分钟刷新、1000项与30天新作窗口', () => {
  expect(DEFAULT_RANKING_SETTINGS).toEqual({
    weights: { likes: 3, favorites: 4, exports: 1 },
    refreshMinutes: 5,
    entryLimit: 1000,
    newcomerWindowDays: 30,
  });
  expect(defaultRankingSettings).toBe(DEFAULT_RANKING_SETTINGS);
  expect(RankingSettingsSchema.parse(DEFAULT_RANKING_SETTINGS)).toEqual(DEFAULT_RANKING_SETTINGS);
});

it('权重允许全零、小数及100边界，拒绝负值、越界、非有限值和字符串', () => {
  for (const weights of [
    { likes: 0, favorites: 0, exports: 0 },
    { likes: 0.25, favorites: 99.5, exports: 100 },
  ])
    expect(RankingSettingsSchema.parse({ ...DEFAULT_RANKING_SETTINGS, weights }).weights).toEqual(
      weights,
    );
  for (const field of ['likes', 'favorites', 'exports'] as const)
    for (const value of [-0.01, 100.01, Number.NaN, Infinity, -Infinity, '3', null])
      expect(
        RankingSettingsSchema.safeParse({
          ...DEFAULT_RANKING_SETTINGS,
          weights: { ...DEFAULT_RANKING_SETTINGS.weights, [field]: value },
        }).success,
      ).toBe(false);
});

it('刷新周期、展示量和新作窗口仅接受各自闭区间内的整数', () => {
  for (const settings of [
    { ...DEFAULT_RANKING_SETTINGS, refreshMinutes: 1, entryLimit: 1, newcomerWindowDays: 1 },
    { ...DEFAULT_RANKING_SETTINGS, refreshMinutes: 60, entryLimit: 1000, newcomerWindowDays: 365 },
  ])
    expect(RankingSettingsSchema.parse(settings)).toEqual(settings);
  for (const [field, maximum] of [
    ['refreshMinutes', 60],
    ['entryLimit', 1000],
    ['newcomerWindowDays', 365],
  ] as const)
    for (const value of [0, -1, maximum + 1, 1.5, Number.NaN, Infinity, '5', null])
      expect(
        RankingSettingsSchema.safeParse({ ...DEFAULT_RANKING_SETTINGS, [field]: value }).success,
      ).toBe(false);
});

it('排行配置拒绝缺失字段、未知顶层字段和额外计分指标', () => {
  for (const settings of [
    {},
    { ...DEFAULT_RANKING_SETTINGS, weights: { likes: 3, favorites: 4 } },
    { ...DEFAULT_RANKING_SETTINGS, algorithm: 'interactions-v2' },
    { ...DEFAULT_RANKING_SETTINGS, weights: { ...DEFAULT_RANKING_SETTINGS.weights, views: 1 } },
  ])
    expect(RankingSettingsSchema.safeParse(settings).success).toBe(false);
});

it('新版批次定义要求正整数来源修订、完整配置与固定604800秒半衰期', () => {
  const definition = {
    settingsRevision: 1,
    settings: DEFAULT_RANKING_SETTINGS,
    halfLifeSeconds: 604800,
  };
  expect(RankingDefinitionSchema.parse(definition)).toEqual(definition);
  for (const settingsRevision of [0, -1, 1.5, Number.NaN, Infinity, '1'])
    expect(RankingDefinitionSchema.safeParse({ ...definition, settingsRevision }).success).toBe(
      false,
    );
  for (const halfLifeSeconds of [0, 604799, 604801, '604800'])
    expect(RankingDefinitionSchema.safeParse({ ...definition, halfLifeSeconds }).success).toBe(
      false,
    );
  for (const value of [
    { settingsRevision: 1, settings: DEFAULT_RANKING_SETTINGS },
    { ...definition, settings: { ...DEFAULT_RANKING_SETTINGS, entryLimit: 1001 } },
    { ...definition, algorithm: 'interactions-v2' },
  ])
    expect(RankingDefinitionSchema.safeParse(value).success).toBe(false);
});

it('设置写入沿用data和有界理由，修订、账号及幂等标识不接受为请求正文', () => {
  const command = { data: DEFAULT_RANKING_SETTINGS, reason: '调整排行运营参数\n保留历史批次' };
  expect(RankingSettingsWriteSchema.parse(command)).toEqual(command);
  for (const reason of ['', '   ', '原因\u0000', '字'.repeat(2001)])
    expect(RankingSettingsWriteSchema.safeParse({ ...command, reason }).success).toBe(false);
  for (const metadata of [
    { expectedRevision: 1 },
    { expectedAccountId: '388a270d-6ca4-4cb9-9d3c-f56138e23e83' },
    { idempotencyKey: 'ad782828-c611-48f9-913b-aae7ce65fc45' },
  ])
    expect(RankingSettingsWriteSchema.safeParse({ ...command, ...metadata }).success).toBe(false);
  expect(rankingSettingsEtag(3)).toBe('"rankings-3"');
});

it('读取响应携带合法默认预览与修改信息，历史前后配置同样完整校验', () => {
  const at = '2026-10-31T10:00:00.000Z';
  const response = {
    data: { ...DEFAULT_RANKING_SETTINGS, entryLimit: 20 },
    defaults: DEFAULT_RANKING_SETTINGS,
    meta: { revision: 2, updatedAt: at, updatedBy: 'ranking_admin' },
  };
  expect(RankingSettingsResponseSchema.parse(response)).toEqual(response);
  expect(
    RankingSettingsResponseSchema.safeParse({
      ...response,
      defaults: { ...DEFAULT_RANKING_SETTINGS, refreshMinutes: 61 },
    }).success,
  ).toBe(false);
  const record = {
    id: 'f4146751-ab5e-4ad0-bc84-7bfedc33c43c',
    actor: 'ranking_admin',
    reason: '缩小公开展示范围',
    before: DEFAULT_RANKING_SETTINGS,
    after: response.data,
    fromRevision: 1,
    toRevision: 2,
    createdAt: at,
  };
  const history = { data: [record], meta: { page: 1, total: 1, pageSize: 20 } };
  expect(RankingSettingsRecordsResponseSchema.parse(history)).toEqual(history);
  expect(
    RankingSettingsRecordsResponseSchema.safeParse({
      ...history,
      data: [{ ...record, before: { ...DEFAULT_RANKING_SETTINGS, entryLimit: 0 } }],
    }).success,
  ).toBe(false);
  expect(
    RankingSettingsRecordsResponseSchema.safeParse({
      ...history,
      data: Array.from({ length: 21 }, () => record),
    }).success,
  ).toBe(false);
  expect(RankingSettingsRecordsQuerySchema.parse({})).toEqual({ page: 1 });
  expect(RankingSettingsRecordsQuerySchema.parse({ page: '100' })).toEqual({ page: 100 });
  expect(RankingSettingsRecordsQuerySchema.safeParse({ page: 101 }).success).toBe(false);
});
