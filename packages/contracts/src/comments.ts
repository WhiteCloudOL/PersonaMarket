import { z } from 'zod';
import { ErrorCodeSchema, IdSchema, TimestampSchema, textSchema } from './common.js';
import { ReleaseVersionSchema } from './releases.js';
import { CommentSettingsSchema } from './comment-settings.js';
export { CommentSettingsSchema, defaultCommentSettings } from './comment-settings.js';
export type { CommentSettings } from './comment-settings.js';

export const CommentBodySchema = textSchema(1, 2000).refine(
  (value) =>
    Array.from(value).every((character) => {
      const code = character.codePointAt(0);
      return code !== undefined && (code >= 32 || [9, 10, 13].includes(code)) && code !== 127;
    }),
  '评论不能包含控制字符',
);
export const CommentIdSchema = z.strictObject({ id: IdSchema });
export const CreateCommentSchema = z
  .strictObject({
    body: CommentBodySchema,
    parentId: IdSchema.optional(),
    replyToId: IdSchema.optional(),
    releaseId: IdSchema.optional(),
  })
  .refine((value) => !value.replyToId || Boolean(value.parentId), {
    message: '回复对象必须属于同一评论楼层',
    path: ['replyToId'],
  });
export const EditCommentSchema = z.strictObject({
  body: CommentBodySchema,
  expectedRevision: z.number().int().positive(),
});
export const DeleteCommentSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
});
export const CommentsQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(2500).default(1),
  pageSize: z.coerce.number().int().min(1).max(20).default(20),
  sort: z.enum(['oldest', 'newest']).default('oldest'),
});
export type CommentsQuery = z.infer<typeof CommentsQuerySchema>;
const CountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const VersionReferenceSchema = z
  .strictObject({ id: IdSchema, version: ReleaseVersionSchema })
  .nullable();
const CommentLocationSchema = z.strictObject({
  id: IdSchema,
  personaId: IdSchema,
  parentId: IdSchema.nullable(),
  replyTo: z.strictObject({ id: IdSchema, username: z.string() }).nullable(),
  release: VersionReferenceSchema,
  createdAt: TimestampSchema,
  replyCount: CountSchema,
});
export const PublicCommentSchema = z.discriminatedUnion('status', [
  CommentLocationSchema.extend({
    status: z.literal('published'),
    body: CommentBodySchema,
    author: z.strictObject({ id: IdSchema, username: z.string().min(3).max(32) }),
    publishedRevisionId: IdSchema,
    editedAt: TimestampSchema.nullable(),
  }),
  CommentLocationSchema.extend({ status: z.enum(['deleted', 'hidden', 'unavailable']) }),
]);
export type PublicComment = z.infer<typeof PublicCommentSchema>;
export const PublicCommentsResponseSchema = z.strictObject({
  data: z.array(PublicCommentSchema).max(20),
  meta: z.strictObject({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive().max(20),
    total: CountSchema,
    publishedCount: CountSchema,
  }),
  settings: CommentSettingsSchema,
});
export const CommentRevisionStateSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED']);
export const OwnCommentRevisionSchema = z.strictObject({
  id: IdSchema,
  number: z.number().int().positive(),
  body: CommentBodySchema,
  status: CommentRevisionStateSchema,
  reason: textSchema(0, 2000).nullable(),
  createdAt: TimestampSchema,
});
export const OwnCommentSchema = z.strictObject({
  id: IdSchema,
  personaId: IdSchema,
  parentId: IdSchema.nullable(),
  release: VersionReferenceSchema,
  visibility: z.enum(['normal', 'deleted', 'hidden']),
  revision: z.number().int().positive(),
  latest: OwnCommentRevisionSchema,
  published: OwnCommentRevisionSchema.nullable(),
  createdAt: TimestampSchema,
});
export const OwnCommentsQuerySchema = CommentsQuerySchema.extend({ personaId: IdSchema });
export const OwnCommentsResponseSchema = z.strictObject({
  data: z.array(OwnCommentSchema).max(20),
  meta: z.strictObject({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive().max(20),
    total: CountSchema,
  }),
});
export const CommentResponseSchema = z.strictObject({ data: OwnCommentSchema });
export const CommentActionResponseSchema = z.strictObject({
  data: z.strictObject({
    id: IdSchema,
    revision: z.number().int().positive(),
    visibility: z.enum(['normal', 'deleted', 'hidden']),
  }),
});
export const ReviewCommentSchema = z
  .strictObject({
    revisionId: IdSchema,
    expectedRevision: z.number().int().positive(),
    decision: z.enum(['approve', 'reject']),
    reason: textSchema(0, 2000).default(''),
    selfReviewConfirmed: z.boolean().default(false),
  })
  .superRefine((value, context) => {
    if (value.decision === 'reject' && !value.reason.trim())
      context.addIssue({ code: 'custom', path: ['reason'], message: '请填写驳回理由' });
  });
export const CommentVisibilitySchema = z.strictObject({
  hidden: z.boolean(),
  expectedRevision: z.number().int().positive(),
  reason: textSchema(1, 2000),
  selfReviewConfirmed: z.boolean().default(false),
});
export const CommentModerationQuerySchema = CommentsQuerySchema.extend({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'hidden', 'all']).default('PENDING'),
  personaId: IdSchema.optional(),
});
export const CommentModerationRecordSchema = z.strictObject({
  id: IdSchema,
  actor: z.string().nullable(),
  action: z.enum(['approve', 'reject', 'auto_approve', 'hide', 'restore', 'delete']),
  reason: textSchema(0, 2000),
  selfReview: z.boolean(),
  revisionId: IdSchema.nullable(),
  createdAt: TimestampSchema,
});
export const AdminCommentSchema = OwnCommentSchema.extend({
  author: z.strictObject({ id: IdSchema, username: z.string() }),
  personaTitle: z.string().nullable(),
  records: z.array(CommentModerationRecordSchema).max(100),
});
export const AdminCommentResponseSchema = z.strictObject({ data: AdminCommentSchema });
export const CommentModerationResponseSchema = z.strictObject({
  data: z.array(AdminCommentSchema).max(20),
  meta: z.strictObject({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive().max(20),
    total: CountSchema,
  }),
});
export const BulkReviewCommentsSchema = z
  .strictObject({
    items: z
      .array(z.strictObject({ id: IdSchema, review: ReviewCommentSchema }))
      .min(1)
      .max(20),
  })
  .refine((value) => new Set(value.items.map((item) => item.id)).size === value.items.length, {
    message: '批量审核不能重复选择同一评论',
    path: ['items'],
  });
export const BulkReviewCommentsResponseSchema = z.strictObject({
  data: z
    .array(
      z.discriminatedUnion('ok', [
        z.strictObject({ id: IdSchema, ok: z.literal(true), data: AdminCommentSchema }),
        z.strictObject({
          id: IdSchema,
          ok: z.literal(false),
          error: z.strictObject({ code: ErrorCodeSchema, message: z.string() }),
        }),
      ]),
    )
    .max(20),
});
