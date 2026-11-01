import { z } from 'zod';
import { IdSchema, TimestampSchema } from './common.js';
import { PublicPersonaCardSchema } from './releases.js';
import {
  LEGACY_RANKING_ALGORITHM,
  CONFIGURABLE_RANKING_ALGORITHM,
  RankingAlgorithmSchema,
  RankingCountSchema,
  type RankingAlgorithm,
} from './ranking-algorithm.js';
import { RankingDefinitionSchema } from './ranking-settings.js';
export * from './ranking-algorithm.js';

export const RANKING_ENTRY_LIMIT = 1_000;
export const RANKING_REFRESH_MS = 5 * 60_000;
export const RankingKindSchema = z.enum([
  'hot',
  'likes',
  'favorites',
  'downloads',
  'new',
  'updated',
]);
export const RankingWindowSchema = z.enum(['7d', '30d', 'all', 'newcomer']);
export const RankingPlatformSchema = z.enum(['all', 'maibot', 'astrbot']);
export type RankingKind = z.infer<typeof RankingKindSchema>;
export type RankingWindow = z.infer<typeof RankingWindowSchema>;

export const rankingWindows: Readonly<Record<RankingKind, readonly RankingWindow[]>> = {
  hot: ['7d'],
  likes: ['7d', '30d', 'all'],
  favorites: ['7d', '30d', 'all'],
  downloads: ['7d', '30d', 'all'],
  new: ['30d', 'newcomer'],
  updated: ['all'],
};
export function rankingBoardCombinations(algorithm: RankingAlgorithm) {
  return RankingKindSchema.options
    .filter(
      (kind) =>
        algorithm !== LEGACY_RANKING_ALGORITHM || (kind !== 'likes' && kind !== 'favorites'),
    )
    .flatMap((kind) =>
      rankingWindows[kind]
        .filter((window) => window !== 'newcomer' || algorithm === CONFIGURABLE_RANKING_ALGORITHM)
        .map((window) => ({ kind, window })),
    );
}
export const RankingQuerySchema = z
  .strictObject({
    kind: RankingKindSchema.default('hot'),
    window: RankingWindowSchema.default('7d'),
    platform: RankingPlatformSchema.default('all'),
    snapshotId: IdSchema.optional(),
    page: z.coerce.number().int().min(1).max(50).default(1),
    pageSize: z.coerce.number().int().min(1).max(20).default(20),
  })
  .superRefine((value, context) => {
    if (!rankingWindows[value.kind].includes(value.window))
      context.addIssue({
        code: 'custom',
        path: ['window'],
        message: '此榜单不支持所选时间范围，请选择可用范围',
      });
    if ((value.page - 1) * value.pageSize >= RANKING_ENTRY_LIMIT)
      context.addIssue({
        code: 'custom',
        path: ['page'],
        message: '已超过榜单展示范围，请返回前面的页码',
      });
  });
export type RankingQuery = z.infer<typeof RankingQuerySchema>;

export const RankingListResponseSchema = z
  .strictObject({
    data: z
      .array(
        PublicPersonaCardSchema.extend({
          position: z.number().int().min(1).max(RANKING_ENTRY_LIMIT),
          score: z.number().finite().nonnegative(),
          eligibleExports: RankingCountSchema,
          eligibleLikes: RankingCountSchema.default(0),
          eligibleFavorites: RankingCountSchema.default(0),
        }),
      )
      .max(20),
    meta: z.strictObject({
      snapshotId: IdSchema,
      algorithm: RankingAlgorithmSchema,
      generatedAt: TimestampSchema,
      refreshAfter: TimestampSchema,
      kind: RankingKindSchema,
      window: RankingWindowSchema,
      platform: RankingPlatformSchema,
      page: z.number().int().min(1).max(50),
      pageSize: z.number().int().min(1).max(20),
      total: z.number().int().nonnegative().max(RANKING_ENTRY_LIMIT),
      stale: z.boolean(),
      limited: z.boolean(),
      entryLimit: z.number().int().min(1).max(RANKING_ENTRY_LIMIT).default(RANKING_ENTRY_LIMIT),
      definition: RankingDefinitionSchema.optional(),
      windowDays: z.number().int().min(1).max(365).nullable().optional(),
    }),
  })
  .superRefine(({ meta }, context) => {
    if ((meta.algorithm === CONFIGURABLE_RANKING_ALGORITHM) !== Boolean(meta.definition))
      context.addIssue({
        code: 'custom',
        path: ['meta', 'definition'],
        message: '可配置算法须提供本批冻结定义，旧算法不接受新定义',
      });
    if (meta.window === 'newcomer' && meta.algorithm !== CONFIGURABLE_RANKING_ALGORITHM)
      context.addIssue({
        code: 'custom',
        path: ['meta', 'window'],
        message: '旧版快照不包含运营新作窗口',
      });
    if (meta.definition) {
      const days =
        meta.window === 'newcomer'
          ? meta.definition.settings.newcomerWindowDays
          : meta.window === '7d'
            ? 7
            : meta.window === '30d'
              ? 30
              : null;
      if (meta.entryLimit !== meta.definition.settings.entryLimit || meta.windowDays !== days)
        context.addIssue({
          code: 'custom',
          path: ['meta'],
          message: '展示上限与时间范围必须对应本批冻结定义',
        });
    }
    if (
      meta.algorithm === LEGACY_RANKING_ALGORITHM &&
      (meta.kind === 'likes' || meta.kind === 'favorites')
    )
      context.addIssue({
        code: 'custom',
        path: ['meta', 'kind'],
        message: '旧版快照不包含此互动榜单，请读取最新榜单',
      });
  });
export const RankingRefreshJobSchema = z.strictObject({
  eventId: IdSchema,
  generationId: IdSchema,
});
export type RankingListResponse = z.infer<typeof RankingListResponseSchema>;
