import { z } from 'zod';
import { IdSchema, TimestampSchema, textSchema } from './common.js';
import { UsernameSchema } from './auth.js';

const singleLine = (min: number, max: number) =>
  textSchema(min, max).refine(
    (value) => value === value.trim() && !/\p{Cc}/u.test(value),
    '请使用不含控制字符或首尾空格的单行文字',
  );
const multiline = (min: number, max: number) =>
  textSchema(min, max).refine(
    (value) =>
      Array.from(value).every(
        (character) => !/\p{Cc}/u.test(character) || ['\t', '\r', '\n'].includes(character),
      ),
    '文字不能包含控制字符',
  );
export const AnnouncementStatusSchema = z.enum(['draft', 'published', 'withdrawn', 'archived']);
export const AnnouncementFieldsSchema = z.strictObject({
  title: singleLine(1, 160),
  summary: singleLine(0, 300),
  body: multiline(1, 20000),
  pinned: z.boolean(),
});
export type AnnouncementFields = z.infer<typeof AnnouncementFieldsSchema>;
export const AnnouncementIdSchema = z.strictObject({ id: IdSchema });
export const AnnouncementWriteSchema = AnnouncementFieldsSchema.extend({
  reason: multiline(1, 2000),
});
export type AnnouncementWrite = z.infer<typeof AnnouncementWriteSchema>;
export const AnnouncementActionSchema = z.strictObject({
  reason: multiline(1, 2000),
  confirmed: z.literal(true),
});
export type AnnouncementAction = z.infer<typeof AnnouncementActionSchema>;
export const AnnouncementActionNameSchema = z.enum(['publish', 'withdraw', 'archive', 'restore']);
export type AnnouncementActionName = z.infer<typeof AnnouncementActionNameSchema>;
export const AnnouncementActionParamsSchema = AnnouncementIdSchema.extend({
  action: AnnouncementActionNameSchema,
});
export function announcementEtag(id: string, revision: number) {
  return '"announcement-' + id.toLowerCase() + '-' + revision + '"';
}
const PageSchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(100).default(1),
  pageSize: z.coerce.number().int().min(1).max(20).default(20),
});
const PageMetaSchema = z.strictObject({
  page: z.number().int().positive(),
  pageSize: z.number().int().min(1).max(20),
  total: z.number().int().nonnegative(),
});
export const AnnouncementRecordsQuerySchema = PageSchema;
export type AnnouncementRecordsQuery = z.infer<typeof AnnouncementRecordsQuerySchema>;
export const AdminAnnouncementsQuerySchema = PageSchema.extend({
  q: singleLine(0, 160).default(''),
  status: z.enum(['all', ...AnnouncementStatusSchema.options]).default('all'),
});
export type AdminAnnouncementsQuery = z.infer<typeof AdminAnnouncementsQuerySchema>;
export const PublicAnnouncementsQuerySchema = PageSchema;
export type PublicAnnouncementsQuery = z.infer<typeof PublicAnnouncementsQuerySchema>;
export const PublicAnnouncementSchema = AnnouncementFieldsSchema.extend({
  id: IdSchema,
  firstPublishedAt: TimestampSchema,
  publishedAt: TimestampSchema,
});
export type PublicAnnouncement = z.infer<typeof PublicAnnouncementSchema>;
export const PublicAnnouncementSummarySchema = PublicAnnouncementSchema.omit({ body: true });
export const PublicAnnouncementResponseSchema = z.strictObject({ data: PublicAnnouncementSchema });
export const AnnouncementSitemapResponseSchema = z.strictObject({
  data: z.array(z.strictObject({ id: IdSchema, publishedAt: TimestampSchema })).max(2000),
});
export const PublicAnnouncementsResponseSchema = z.strictObject({
  data: z.array(PublicAnnouncementSummarySchema).max(20),
  meta: PageMetaSchema,
});
export const ManagedAnnouncementSchema = AnnouncementFieldsSchema.extend({
  id: IdSchema,
  status: AnnouncementStatusSchema,
  revision: z.number().int().positive(),
  updatedAt: TimestampSchema,
  published: PublicAnnouncementSchema.nullable(),
  hasUnpublishedChanges: z.boolean(),
});
export type ManagedAnnouncement = z.infer<typeof ManagedAnnouncementSchema>;
export const AdminAnnouncementResponseSchema = z.strictObject({ data: ManagedAnnouncementSchema });
export const AdminAnnouncementSummarySchema = ManagedAnnouncementSchema.omit({
  body: true,
  published: true,
}).extend({ publishedTitle: z.string().nullable() });
export const AdminAnnouncementsResponseSchema = z.strictObject({
  data: z.array(AdminAnnouncementSummarySchema).max(20),
  meta: PageMetaSchema,
});
export const AnnouncementRecordSnapshotSchema = z.strictObject({
  title: z.string(),
  status: AnnouncementStatusSchema,
  pinned: z.boolean(),
  revision: z.number().int().positive(),
  bodyCharacters: z.number().int().nonnegative(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  publishedContentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
});
export const AnnouncementRecordsResponseSchema = z.strictObject({
  data: z
    .array(
      z.strictObject({
        id: IdSchema,
        actor: UsernameSchema,
        action: z.enum(['created', 'edited', 'published', 'withdrawn', 'archived', 'restored']),
        reason: multiline(1, 2000),
        before: AnnouncementRecordSnapshotSchema.nullable(),
        after: AnnouncementRecordSnapshotSchema,
        createdAt: TimestampSchema,
      }),
    )
    .max(20),
  meta: PageMetaSchema,
});
