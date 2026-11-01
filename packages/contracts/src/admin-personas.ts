import { z } from 'zod';
import { AccountStatusSchema, UsernameSchema } from './auth.js';
import {
  ErrorCodeSchema,
  IdSchema,
  PlatformSchema,
  TimestampSchema,
  textSchema,
} from './common.js';
import { PersonaCurationSchema, SetPersonaCurationSchema } from './curation.js';

export const AdminPersonasQuerySchema = z.strictObject({
  q: z
    .string()
    .trim()
    .max(160)
    .refine((value) => !/\p{Cc}/u.test(value), '搜索不能包含控制字符')
    .default(''),
  platform: z.enum(['all', 'maibot', 'astrbot']).default('all'),
  ownerId: IdSchema.optional(),
  categoryId: IdSchema.optional(),
  state: z.enum(['all', 'public', 'unpublished', 'pending', 'hidden', 'blocked']).default('all'),
  official: z.enum(['all', 'true', 'false']).default('all'),
  featured: z.enum(['all', 'true', 'false']).default('all'),
  sort: z.enum(['updated', 'newest', 'oldest']).default('updated'),
  page: z.coerce.number().int().min(1).max(2500).default(1),
  pageSize: z.coerce.number().int().min(1).max(20).default(20),
});
export type AdminPersonasQuery = z.infer<typeof AdminPersonasQuerySchema>;
export const AdminPersonaIdSchema = z.strictObject({ id: IdSchema });
export const AdminPersonaSummarySchema = z.strictObject({
  id: IdSchema,
  owner: z.strictObject({ id: IdSchema, username: UsernameSchema, status: AccountStatusSchema }),
  platform: PlatformSchema,
  title: textSchema(0, 120),
  category: z.strictObject({ id: IdSchema, name: textSchema(1, 80) }).nullable(),
  revision: z.number().int().positive(),
  draftRevision: z.number().int().positive().nullable(),
  ownerVisibility: z.enum(['listed', 'hidden']),
  moderationState: z.enum(['normal', 'blocked']),
  publiclyVisible: z.boolean(),
  curation: PersonaCurationSchema.default({ official: false, featured: false }),
  publishedReleaseId: IdSchema.nullable(),
  publishedSubmissionId: IdSchema.nullable().default(null),
  pendingCount: z.number().int().nonnegative(),
  latestPendingSubmissionId: IdSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export const AdminPersonasResponseSchema = z.strictObject({
  data: z.array(AdminPersonaSummarySchema).max(20),
  meta: z.strictObject({
    page: z.number().int().positive(),
    pageSize: z.number().int().min(1).max(20),
    total: z.number().int().nonnegative(),
  }),
});
export const AdminPersonaResponseSchema = z.strictObject({ data: AdminPersonaSummarySchema });

export const AdminPersonaRecordsQuerySchema = AdminPersonasQuerySchema.pick({
  page: true,
  pageSize: true,
});
export type AdminPersonaRecordsQuery = z.infer<typeof AdminPersonaRecordsQuerySchema>;
export const AdminPersonaRecordsResponseSchema = z.strictObject({
  data: z
    .array(
      z.strictObject({
        id: IdSchema,
        actor: UsernameSchema,
        action: z.string().min(1).max(64),
        reason: textSchema(0, 5000),
        selfReview: z.boolean(),
        submissionId: IdSchema.nullable(),
        createdAt: TimestampSchema,
      }),
    )
    .max(20),
  meta: z.strictObject({
    page: z.number().int().positive(),
    pageSize: z.number().int().min(1).max(20),
    total: z.number().int().nonnegative(),
  }),
});

const BulkItemsSchema = z
  .array(
    z.strictObject({
      id: IdSchema,
      expectedRevision: z.number().int().positive(),
      idempotencyKey: IdSchema,
    }),
  )
  .min(1)
  .max(20)
  .superRefine((items, context) => {
    if (new Set(items.map((item) => item.id.toLowerCase())).size !== items.length)
      context.addIssue({ code: 'custom', message: '不能重复选择同一人设' });
    if (new Set(items.map((item) => item.idempotencyKey.toLowerCase())).size !== items.length)
      context.addIssue({ code: 'custom', message: '每条人设需要独立的操作标识' });
  });
const BulkPersonaBase = z.strictObject({
  items: BulkItemsSchema,
  reason: SetPersonaCurationSchema.shape.reason,
});
export const AdminPersonaBulkRequestSchema = z.discriminatedUnion('action', [
  BulkPersonaBase.extend({ action: z.literal('block') }),
  BulkPersonaBase.extend({ action: z.literal('restore') }),
  BulkPersonaBase.extend({
    action: z.literal('curate'),
    official: z.boolean(),
    featured: z.boolean(),
    selfReviewConfirmed: z.boolean().default(false),
  }),
]);
export type AdminPersonaBulkRequest = z.infer<typeof AdminPersonaBulkRequestSchema>;
export const AdminPersonaBulkResponseSchema = z.strictObject({
  data: z
    .array(
      z.discriminatedUnion('ok', [
        z.strictObject({ id: IdSchema, ok: z.literal(true), message: z.string() }),
        z.strictObject({
          id: IdSchema,
          ok: z.literal(false),
          error: z.strictObject({ code: ErrorCodeSchema, message: z.string() }),
        }),
      ]),
    )
    .max(20),
});
