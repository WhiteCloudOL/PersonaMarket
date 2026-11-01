import { z } from 'zod';
import { IdSchema, TimestampSchema } from './common.js';
import { PublicPersonaCardSchema } from './releases.js';

export const FavoriteSchema = z.discriminatedUnion('available', [
  z.strictObject({
    available: z.literal(true),
    personaId: IdSchema,
    savedAt: TimestampSchema,
    persona: PublicPersonaCardSchema,
  }),
  z.strictObject({ available: z.literal(false), personaId: IdSchema, savedAt: TimestampSchema }),
]);
export const FavoritesResponseSchema = z.strictObject({
  data: z.array(FavoriteSchema).max(20),
  meta: z.strictObject({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive().max(20),
    total: z.number().int().nonnegative(),
  }),
});
