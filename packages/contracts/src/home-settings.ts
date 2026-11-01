import { z } from 'zod';
import { TimestampSchema, textSchema } from './common.js';
import { UsernameSchema } from './auth.js';

export const HomeSectionKeySchema = z.enum(['featured', 'recent', 'announcements', 'creation']);
export const OptionalNavigationKeySchema = z.enum([
  'rankings',
  'publish',
  'guides',
  'announcements',
]);
const line = (max: number) =>
  textSchema(1, max).refine(
    (value) => value === value.trim() && !/\p{Cc}/u.test(value),
    '请使用不含控制字符或首尾空格的单行文字',
  );
export const HomeSettingsSchema = z.strictObject({
  heroNote: line(200),
  sections: z
    .array(z.strictObject({ key: HomeSectionKeySchema, enabled: z.boolean() }))
    .length(4)
    .refine((rows) => new Set(rows.map((row) => row.key)).size === 4, '每个首页模块需要保留一次'),
  featuredCount: z.number().int().min(1).max(12),
  recentCount: z.number().int().min(1).max(12),
  announcementCount: z.number().int().min(1).max(5),
  navigation: z
    .array(OptionalNavigationKeySchema)
    .max(4)
    .refine((keys) => new Set(keys).size === keys.length, '导航项目不能重复'),
});
export type HomeSettings = z.infer<typeof HomeSettingsSchema>;
export type HomeSectionKey = z.infer<typeof HomeSectionKeySchema>;
export type OptionalNavigationKey = z.infer<typeof OptionalNavigationKeySchema>;
export const defaultHomeSettings = {
  heroNote: '把想象写进故事，让每一次对话都有温度',
  sections: [
    { key: 'featured', enabled: true },
    { key: 'recent', enabled: true },
    { key: 'announcements', enabled: true },
    { key: 'creation', enabled: true },
  ],
  featuredCount: 4,
  recentCount: 4,
  announcementCount: 3,
  navigation: ['rankings', 'publish', 'guides', 'announcements'],
} satisfies HomeSettings;
export const HomeSettingsWriteSchema = z.strictObject({
  data: HomeSettingsSchema,
  reason: textSchema(1, 2000).refine(
    (value) =>
      Array.from(value).every(
        (character) => !/\p{Cc}/u.test(character) || ['\t', '\r', '\n'].includes(character),
      ),
    '处理理由不能包含控制字符',
  ),
});
export type HomeSettingsWrite = z.infer<typeof HomeSettingsWriteSchema>;
const positiveInteger = z.number().int().positive();
export function homeSettingsEtag(value: number) {
  return '"home-' + value + '"';
}
export const PublicHomeSettingsResponseSchema = z.strictObject({
  data: HomeSettingsSchema,
  meta: z.strictObject({ revision: positiveInteger }),
});
export const HomeSettingsResponseSchema = PublicHomeSettingsResponseSchema.extend({
  defaults: HomeSettingsSchema,
  meta: z.strictObject({
    revision: positiveInteger,
    updatedAt: TimestampSchema,
    updatedBy: UsernameSchema.nullable(),
  }),
});
export type HomeSettingsResponse = z.infer<typeof HomeSettingsResponseSchema>;
export const HomeSettingsRecordsQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(100).default(1),
});
export type HomeSettingsRecordsQuery = z.infer<typeof HomeSettingsRecordsQuerySchema>;
export const HomeSettingsRecordsResponseSchema = z.strictObject({
  data: z
    .array(
      z.strictObject({
        id: z.uuid(),
        actor: UsernameSchema,
        reason: textSchema(1, 2000),
        before: HomeSettingsSchema,
        after: HomeSettingsSchema,
        fromRevision: positiveInteger,
        toRevision: positiveInteger,
        createdAt: TimestampSchema,
      }),
    )
    .max(20),
  meta: z.strictObject({
    page: positiveInteger,
    total: z.number().int().nonnegative(),
    pageSize: z.literal(20),
  }),
});
