import { z } from 'zod';

export const LEGACY_RANKING_ALGORITHM = 'exports-v1';
export const RANKING_ALGORITHM = 'interactions-v1';
export const CONFIGURABLE_RANKING_ALGORITHM = 'interactions-v2';
export const RankingAlgorithmSchema = z.enum([
  LEGACY_RANKING_ALGORITHM,
  RANKING_ALGORITHM,
  CONFIGURABLE_RANKING_ALGORITHM,
]);
export type RankingAlgorithm = z.infer<typeof RankingAlgorithmSchema>;
export const INTERACTION_RANKING_WEIGHTS = { likes: 3, favorites: 4, exports: 1 } as const;
export const RANKING_HEAT_HALF_LIFE_SECONDS = 7 * 24 * 60 * 60;
export const RankingCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const RankingHeatBaseSchema = z.strictObject({
  score: z.number().finite().nonnegative(),
  eligibleExports: RankingCountSchema,
});
export const RankingHeatMetricSchema = z.discriminatedUnion('algorithm', [
  RankingHeatBaseSchema.extend({
    algorithm: z.literal(LEGACY_RANKING_ALGORITHM),
    eligibleLikes: z.literal(0).optional(),
    eligibleFavorites: z.literal(0).optional(),
  }),
  RankingHeatBaseSchema.extend({
    algorithm: z.literal(RANKING_ALGORITHM),
    eligibleLikes: RankingCountSchema,
    eligibleFavorites: RankingCountSchema,
  }),
]);
export const RankingInteractionMetricSchema = z.strictObject({
  kind: z.enum(['likes', 'favorites']),
  eligibleCount: RankingCountSchema,
});
