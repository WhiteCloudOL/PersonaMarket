import { z } from 'zod';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const PublicStatisticsResponseSchema = z.strictObject({
  data: z.strictObject({ personas: count, creators: count, exports: count }),
});
export const PublicPersonaMetricsResponseSchema = z.strictObject({
  data: z.strictObject({ exports: count }),
});
