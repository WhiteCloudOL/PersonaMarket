import { z } from 'zod';
import { IdSchema, TimestampSchema } from './common.js';
import { RankingAlgorithmSchema } from './ranking-algorithm.js';
import {
  HomeSettingsWriteSchema,
  HomeSettingsResponseSchema,
  HomeSettingsRecordsResponseSchema,
  HomeSettingsRecordsQuerySchema,
} from './home-settings.js';

const rankingWeight = z.number().finite().min(0).max(100);
export const RankingSettingsSchema = z.strictObject({
  weights: z.strictObject({
    likes: rankingWeight,
    favorites: rankingWeight,
    exports: rankingWeight,
  }),
  refreshMinutes: z.number().int().min(1).max(60),
  entryLimit: z.number().int().min(1).max(1000),
  newcomerWindowDays: z.number().int().min(1).max(365),
});
export type RankingSettings = z.infer<typeof RankingSettingsSchema>;
export const DEFAULT_RANKING_SETTINGS: RankingSettings = {
  weights: { likes: 3, favorites: 4, exports: 1 },
  refreshMinutes: 5,
  entryLimit: 1000,
  newcomerWindowDays: 30,
};
export const defaultRankingSettings = DEFAULT_RANKING_SETTINGS;

/** 仅供可配置的新版算法使用，历史算法继续保留各自固定定义。 */
export const RankingDefinitionSchema = z.strictObject({
  settingsRevision: z.number().int().positive(),
  settings: RankingSettingsSchema,
  halfLifeSeconds: z.literal(604800),
});
export type RankingDefinition = z.infer<typeof RankingDefinitionSchema>;
export const RankingSettingsWriteSchema = HomeSettingsWriteSchema.extend({
  data: RankingSettingsSchema,
});
export type RankingSettingsWrite = z.infer<typeof RankingSettingsWriteSchema>;
export const RankingSettingsResponseSchema = HomeSettingsResponseSchema.extend({
  data: RankingSettingsSchema,
  defaults: RankingSettingsSchema,
});
export type RankingSettingsResponse = z.infer<typeof RankingSettingsResponseSchema>;
export const RankingSettingsRecordsQuerySchema = HomeSettingsRecordsQuerySchema;
export type RankingSettingsRecordsQuery = z.infer<typeof RankingSettingsRecordsQuerySchema>;
export const RankingSettingsRecordsResponseSchema = HomeSettingsRecordsResponseSchema.extend({
  data: z
    .array(
      HomeSettingsRecordsResponseSchema.shape.data.element.extend({
        before: RankingSettingsSchema,
        after: RankingSettingsSchema,
      }),
    )
    .max(20),
});
export type RankingSettingsRecordsResponse = z.infer<typeof RankingSettingsRecordsResponseSchema>;
export const rankingSettingsEtag = (revision: number) => '"rankings-' + revision + '"';

export const RankingRuntimeGenerationSchema = z.strictObject({
  id: IdSchema,
  algorithm: RankingAlgorithmSchema,
  status: z.enum(['pending', 'completed', 'failed']),
  definition: RankingDefinitionSchema.nullable(),
  requestedAt: TimestampSchema,
  generatedAt: TimestampSchema.nullable(),
  errorCode: z.string().max(64).nullable(),
});
export const RankingRuntimeResponseSchema = z.strictObject({
  data: z.strictObject({
    latestRequest: RankingRuntimeGenerationSchema.nullable(),
    latestCompleted: RankingRuntimeGenerationSchema.nullable(),
  }),
  meta: z.strictObject({ settingsRevision: z.number().int().positive() }),
});
export type RankingRuntimeResponse = z.infer<typeof RankingRuntimeResponseSchema>;
