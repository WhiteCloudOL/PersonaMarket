import { z } from 'zod';
import { IdSchema, TimestampSchema, textSchema } from './common.js';
import { UsernameSchema } from './auth.js';

export const TaxonomyKindSchema = z.enum(['category', 'tag']);
export type TaxonomyKind = z.infer<typeof TaxonomyKindSchema>;
export function taxonomyEntryEtag(kind: TaxonomyKind, id: string, revision: number) {
  return '"' + kind + '-' + id.toLowerCase() + '-' + revision + '"';
}
export const TaxonomyEntryIdSchema = z.strictObject({ id: IdSchema });
const NameSchema = textSchema(1, 80).refine(
  (value) => value === value.trim() && !/\p{Cc}/u.test(value),
  '名称不能包含控制字符或首尾空格',
);
const ReasonSchema = textSchema(1, 2000).refine(
  (value) =>
    Array.from(value).every(
      (character) => !/\p{Cc}/u.test(character) || ['\t', '\n', '\r'].includes(character),
    ),
  '处理理由不能包含控制字符',
);
export const TaxonomyEntryFieldsSchema = z.strictObject({
  name: NameSchema,
  active: z.boolean({ error: '请选择启用状态' }),
  sortOrder: z
    .number({ error: '请输入整数排序值' })
    .int('排序值必须为整数')
    .min(-10000, '排序值不能小于 -10,000')
    .max(10000, '排序值不能大于 10,000'),
});
export const CreateTaxonomyEntrySchema = TaxonomyEntryFieldsSchema.extend({ reason: ReasonSchema });
export type CreateTaxonomyEntry = z.infer<typeof CreateTaxonomyEntrySchema>;
export const UpdateTaxonomyEntrySchema = CreateTaxonomyEntrySchema;
export type UpdateTaxonomyEntry = z.infer<typeof UpdateTaxonomyEntrySchema>;
export const TaxonomyActionSchema = z.strictObject({ reason: ReasonSchema });
export type TaxonomyAction = z.infer<typeof TaxonomyActionSchema>;
export const TaxonomyManagementQuerySchema = z.strictObject({
  q: z
    .string()
    .trim()
    .max(160)
    .refine((value) => !/\p{Cc}/u.test(value), '搜索不能包含控制字符')
    .default(''),
  state: z.enum(['all', 'active', 'disabled', 'archived']).default('all'),
  page: z.coerce.number().int().min(1).max(50).default(1),
  pageSize: z.coerce.number().int().min(1).max(20).default(20),
});
export type TaxonomyManagementQuery = z.infer<typeof TaxonomyManagementQuerySchema>;
export const TaxonomyManagementPaginationSchema = TaxonomyManagementQuerySchema.pick({
  page: true,
  pageSize: true,
});
export type TaxonomyManagementPagination = z.infer<typeof TaxonomyManagementPaginationSchema>;
const PageMetaSchema = z.strictObject({
  page: z.number().int().positive(),
  pageSize: z.number().int().min(1).max(20),
  total: z.number().int().nonnegative(),
});
export const ManagedTaxonomyEntrySchema = TaxonomyEntryFieldsSchema.extend({
  id: IdSchema,
  kind: TaxonomyKindSchema,
  revision: z.number().int().positive(),
  archivedAt: TimestampSchema.nullable(),
  updatedAt: TimestampSchema,
});
export type ManagedTaxonomyEntry = z.infer<typeof ManagedTaxonomyEntrySchema>;
export const TaxonomyManagementListResponseSchema = z.strictObject({
  data: z.array(ManagedTaxonomyEntrySchema).max(20),
  meta: PageMetaSchema,
});
export const TaxonomyManagementDetailResponseSchema = z.strictObject({
  data: ManagedTaxonomyEntrySchema,
  usage: z.strictObject({
    drafts: z.number().int().nonnegative(),
    submissions: z.number().int().nonnegative(),
  }),
});
const RecordSnapshotSchema = TaxonomyEntryFieldsSchema.extend({
  revision: z.number().int().positive(),
  archivedAt: TimestampSchema.nullable(),
});
export const TaxonomyManagementRecordsResponseSchema = z.strictObject({
  data: z
    .array(
      z.strictObject({
        id: IdSchema,
        action: z.enum(['created', 'updated', 'archived', 'restored']),
        actor: UsernameSchema,
        reason: ReasonSchema,
        before: RecordSnapshotSchema.nullable(),
        after: RecordSnapshotSchema,
        createdAt: TimestampSchema,
      }),
    )
    .max(20),
  meta: PageMetaSchema,
});
