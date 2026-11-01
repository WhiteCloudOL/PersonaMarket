import { z } from 'zod';
import { IdSchema, TimestampSchema, textSchema } from './common.js';
import { UsernameSchema } from './auth.js';

export const GuideSlugSchema = z.enum([
  'getting-started',
  'maibot',
  'astrbot',
  'create-draft',
  'images-readme',
  'source-license',
  'publish',
  'import-files',
  'troubleshooting',
]);
export type GuideSlug = z.infer<typeof GuideSlugSchema>;
export const GuideParamsSchema = z.strictObject({ slug: GuideSlugSchema });
const line = (min: number, max: number) =>
  textSchema(min, max).refine(
    (value) => value === value.trim() && !/\p{Cc}/u.test(value),
    '请使用不含控制字符或首尾空格的单行文字',
  );
const multiline = (min: number, max: number) =>
  textSchema(min, max).refine(
    (value) =>
      Array.from(value).every(
        (character) => !/\p{Cc}/u.test(character) || ['\t', '\n', '\r'].includes(character),
      ),
    '内容不能包含不可见控制字符',
  );
export const GuideFieldsSchema = z.strictObject({
  title: line(1, 160),
  summary: line(0, 300),
  bodyMarkdown: multiline(1, 30000),
});
export type GuideFields = z.infer<typeof GuideFieldsSchema>;
export const GuideWriteSchema = GuideFieldsSchema.extend({ reason: multiline(1, 2000) });
export type GuideWrite = z.infer<typeof GuideWriteSchema>;
export const GuideActionSchema = z.strictObject({
  reason: multiline(1, 2000),
  confirmed: z.literal(true),
});
export type GuideAction = z.infer<typeof GuideActionSchema>;
export const GuideActionNameSchema = z.enum(['publish', 'withdraw']);
export type GuideActionName = z.infer<typeof GuideActionNameSchema>;
export const GuideActionParamsSchema = GuideParamsSchema.extend({ action: GuideActionNameSchema });
export const GuideStatusSchema = z.enum(['draft', 'published', 'withdrawn']);
export function guideEtag(slug: GuideSlug, revision: number) {
  return '"guide-' + slug + '-' + revision + '"';
}
export const PublicGuideSchema = GuideFieldsSchema.extend({
  slug: GuideSlugSchema,
  publicationId: IdSchema,
  publishedAt: TimestampSchema,
});
export type PublicGuide = z.infer<typeof PublicGuideSchema>;
export const PublicGuideResponseSchema = z.strictObject({ data: PublicGuideSchema });
export const PublicGuidesResponseSchema = z.strictObject({
  data: z.array(PublicGuideSchema).max(9),
});
export const GuideSitemapResponseSchema = z.strictObject({
  data: z.array(PublicGuideSchema.pick({ slug: true, publishedAt: true })).max(9),
});
export const ManagedGuideSchema = GuideFieldsSchema.extend({
  slug: GuideSlugSchema,
  revision: z.number().int().positive(),
  status: GuideStatusSchema,
  updatedAt: TimestampSchema,
  updatedBy: UsernameSchema.nullable(),
  published: PublicGuideSchema.nullable(),
  hasUnpublishedChanges: z.boolean(),
});
export type ManagedGuide = z.infer<typeof ManagedGuideSchema>;
export const AdminGuideResponseSchema = z.strictObject({ data: ManagedGuideSchema });
export const AdminGuidesQuerySchema = z.strictObject({
  q: line(0, 160).default(''),
  status: z.enum(['all', ...GuideStatusSchema.options]).default('all'),
});
export type AdminGuidesQuery = z.infer<typeof AdminGuidesQuerySchema>;
export const AdminGuidesResponseSchema = z.strictObject({
  data: z
    .array(
      ManagedGuideSchema.omit({ bodyMarkdown: true, published: true }).extend({
        publishedTitle: z.string().nullable(),
        publishedAt: TimestampSchema.nullable(),
      }),
    )
    .max(9),
});
export const GuideRecordSnapshotSchema = GuideFieldsSchema.extend({
  revision: z.number().int().positive(),
  status: GuideStatusSchema,
  publishedId: IdSchema.nullable(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  publishedContentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
});
export const GuideRecordsQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(100).default(1),
});
export type GuideRecordsQuery = z.infer<typeof GuideRecordsQuerySchema>;
export const GuideRecordsResponseSchema = z.strictObject({
  data: z
    .array(
      z.strictObject({
        id: IdSchema,
        actor: UsernameSchema,
        action: z.enum(['edited', 'published', 'withdrawn']),
        reason: multiline(1, 2000),
        before: GuideRecordSnapshotSchema,
        after: GuideRecordSnapshotSchema,
        createdAt: TimestampSchema,
      }),
    )
    .max(20),
  meta: z.strictObject({
    page: z.number().int().positive(),
    pageSize: z.literal(20),
    total: z.number().int().nonnegative(),
  }),
});
