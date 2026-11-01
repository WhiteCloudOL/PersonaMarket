import { z } from 'zod';
import { IdSchema, PlatformSchema } from './common.js';
import { CommentSettingsSchema, defaultCommentSettings } from './comment-settings.js';

export const InteractionCountsSchema = z.strictObject({
  likes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  favorites: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
export type InteractionCounts = z.infer<typeof InteractionCountsSchema>;
export const InteractionCommandSchema = z.strictObject({}).default({});
export const InteractionSettingsSchema = CommentSettingsSchema.extend({
  likesEnabled: z.boolean(),
  favoritesEnabled: z.boolean(),
});
export const defaultInteractionSettings = {
  likesEnabled: true,
  favoritesEnabled: true,
  ...defaultCommentSettings,
} as const;
export const InteractionSettingsResponseSchema = z.strictObject({
  data: InteractionSettingsSchema,
  defaults: InteractionSettingsSchema,
  meta: z.strictObject({ revision: z.number().int().positive() }),
});
export const InteractionBatchQuerySchema = z.strictObject({
  ids: z
    .string()
    .min(36)
    .max(1849)
    .refine((value) => {
      const ids = value.split(',');
      return ids.length <= 50 && ids.every((id) => IdSchema.safeParse(id).success);
    }, '请选择最多 50 个有效人设'),
});
export const OwnInteractionSchema = z.strictObject({
  personaId: IdSchema,
  counts: InteractionCountsSchema,
  liked: z.boolean(),
  favorited: z.boolean(),
});
export const OwnInteractionsResponseSchema = z.strictObject({
  data: z.array(OwnInteractionSchema).max(50),
  settings: InteractionSettingsSchema,
});
export const InteractionResponseSchema = z.strictObject({
  data: z.discriminatedUnion('available', [
    OwnInteractionSchema.extend({ available: z.literal(true), counts: InteractionCountsSchema }),
    z.strictObject({
      personaId: IdSchema,
      available: z.literal(false),
      favorited: z.literal(false),
    }),
  ]),
  settings: InteractionSettingsSchema,
});
export const FavoritesQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(20).default(20),
  sort: z.enum(['newest', 'oldest', 'updated', 'title']).default('newest'),
  platform: PlatformSchema.optional(),
  availability: z.enum(['all', 'available', 'unavailable']).default('all'),
  q: z
    .string()
    .max(100)
    .refine((value) => !value.includes('\0'), '搜索词不能包含空字符')
    .default(''),
});
export type FavoritesQuery = z.infer<typeof FavoritesQuerySchema>;
