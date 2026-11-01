import { z } from 'zod';
import { IdSchema, PlatformSchema, TimestampSchema, textSchema } from './common.js';
import { AccountStatusSchema, UserRoleSchema, UsernameSchema } from './auth.js';
import { ReleaseVersionSchema } from './releases.js';
import { PublicCardSnapshotSchema } from './persona.js';
import { CommentBodySchema } from './comments.js';
import { ProfileContentSchema } from './profiles.js';

const multiline = (min: number, max: number) =>
  textSchema(min, max).refine(
    (value) =>
      Array.from(value).every(
        (character) => !/[\p{Cc}]/u.test(character) || ['\t', '\n', '\r'].includes(character),
      ),
    '内容不能包含不可见控制字符',
  );
export const ReportReasonSchema = z.enum(['copyright', 'inappropriate', 'spam', 'other']);
export const ReportStatusSchema = z.enum(['pending', 'processing', 'resolved', 'dismissed']);
export type ReportStatus = z.infer<typeof ReportStatusSchema>;
export const ReportTypeSchema = z.enum(['persona', 'comment', 'profile']);
export const ReportTargetSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('persona'),
    personaId: IdSchema,
    releaseId: IdSchema.optional(),
  }),
  z.strictObject({ type: z.literal('comment'), commentId: IdSchema }),
  z.strictObject({ type: z.literal('profile'), userId: IdSchema, submissionId: IdSchema }),
]);
export const CreateReportSchema = z.strictObject({
  target: ReportTargetSchema,
  reason: ReportReasonSchema,
  details: multiline(0, 5000).default(''),
});
export type CreateReport = z.infer<typeof CreateReportSchema>;
const context = {
  personaId: IdSchema,
  releaseId: IdSchema,
  version: ReleaseVersionSchema,
  title: PublicCardSnapshotSchema.shape.title,
  summary: PublicCardSnapshotSchema.shape.summary,
  platform: PlatformSchema,
  author: z.strictObject({ id: IdSchema, username: UsernameSchema }),
};
export const ProfileReportSnapshotSchema = z.strictObject({
  type: z.literal('profile'),
  title: ProfileContentSchema.shape.displayName,
  author: context.author,
  profile: z.strictObject({
    userId: IdSchema,
    submissionId: IdSchema,
    content: ProfileContentSchema,
  }),
});
// 只冻结已公开的目标信息；作品正文由不可变Release引用保留，不复制私有授权证据
export const PersonaReportSnapshotSchema = z.strictObject({
  type: z.literal('persona'),
  ...context,
});
export const CommentReportSnapshotSchema = z.strictObject({
  type: z.literal('comment'),
  ...context,
  comment: z.strictObject({ id: IdSchema, revisionId: IdSchema, body: CommentBodySchema }),
});
export const ReportSnapshotSchema = z.discriminatedUnion('type', [
  PersonaReportSnapshotSchema,
  CommentReportSnapshotSchema,
  // 旧两种证据的字段与顺序保持不变，避免改变已保存的证据哈希
  ProfileReportSnapshotSchema,
]);
export type ReportSnapshot = z.infer<typeof ReportSnapshotSchema>;
export const ReportIdSchema = z.strictObject({ id: IdSchema });
const pagination = {
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(20).max(20).default(20),
};
export const OwnReportsQuerySchema = z.strictObject({
  ...pagination,
  status: z.enum(['all', ...ReportStatusSchema.options]).default('all'),
});
export type OwnReportsQuery = z.infer<typeof OwnReportsQuerySchema>;
export const AdminReportsQuerySchema = OwnReportsQuerySchema.extend({
  status: z.enum(['all', ...ReportStatusSchema.options]).default('pending'),
  type: z.enum(['all', ...ReportTypeSchema.options]).default('all'),
  id: IdSchema.optional(),
});
export type AdminReportsQuery = z.infer<typeof AdminReportsQuerySchema>;
export const ReportRecordsQuerySchema = z.strictObject(pagination);
export type ReportRecordsQuery = z.infer<typeof ReportRecordsQuerySchema>;
export const ReportSummarySchema = z.strictObject({
  id: IdSchema,
  type: ReportTypeSchema,
  personaId: IdSchema.nullable(),
  personaTitle: textSchema(1, 80),
  platform: PlatformSchema.nullable(),
  version: ReleaseVersionSchema.nullable(),
  reason: ReportReasonSchema,
  status: ReportStatusSchema,
  revision: z.number().int().positive(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export const OwnReportSchema = ReportSummarySchema.extend({
  details: multiline(0, 5000),
  snapshot: ReportSnapshotSchema,
  publicPath: z
    .string()
    .regex(/^\/(personas|users)\//)
    .nullable(),
});
export type OwnReport = z.infer<typeof OwnReportSchema>;
export const ReportModerationTargetSchema = z.strictObject({
  persona: z
    .strictObject({
      revision: z.number().int().positive(),
      state: z.enum(['normal', 'blocked']),
    })
    .nullable(),
  release: z
    .strictObject({
      revision: z.number().int().positive(),
      state: z.enum(['UNPUBLISHED', 'PUBLISHED', 'WITHDRAWN', 'BLOCKED']),
    })
    .nullable(),
  profile: z
    .strictObject({
      revision: z.number().int().positive(),
      visibility: z.enum(['normal', 'hidden']),
      publishedSubmissionId: IdSchema.nullable(),
    })
    .nullable()
    .optional(),
  comment: z
    .strictObject({
      revision: z.number().int().positive(),
      visibility: z.enum(['normal', 'hidden', 'deleted']),
    })
    .nullable(),
  account: z.strictObject({
    id: IdSchema,
    role: UserRoleSchema,
    status: AccountStatusSchema,
    securityVersion: z.number().int().positive(),
  }),
});
export const AdminReportSummarySchema = ReportSummarySchema.extend({
  reporter: z.strictObject({ id: IdSchema, username: UsernameSchema }),
});
export const AdminReportSchema = OwnReportSchema.extend({
  reporter: AdminReportSummarySchema.shape.reporter,
  moderation: ReportModerationTargetSchema,
});
export type AdminReport = z.infer<typeof AdminReportSchema>;
const meta = z.strictObject({
  page: z.number().int().positive(),
  pageSize: z.literal(20),
  total: z.number().int().nonnegative(),
});
export const OwnReportResponseSchema = z.strictObject({ data: OwnReportSchema });
export const OwnReportsResponseSchema = z.strictObject({
  data: z.array(ReportSummarySchema).max(20),
  meta,
});
export const AdminReportResponseSchema = z.strictObject({ data: AdminReportSchema });
export const AdminReportsResponseSchema = z.strictObject({
  data: z.array(AdminReportSummarySchema).max(20),
  meta,
});
export const ReportContentActionSchema = z.enum([
  'block_persona',
  'block_release',
  'hide_comment',
  'hide_profile',
]);
export const ReportResolutionSchema = z
  .strictObject({
    reason: multiline(1, 2000),
    content: z
      .strictObject({
        action: ReportContentActionSchema,
        expectedRevision: z.number().int().positive(),
      })
      .optional(),
    account: z
      .strictObject({
        action: z.literal('ban'),
        expectedSecurityVersion: z.number().int().positive(),
        scope: z.enum(['account_only', 'account_and_personas']),
      })
      .optional(),
  })
  .superRefine((value, context) => {
    if (!value.reason.trim())
      context.addIssue({ code: 'custom', path: ['reason'], message: '请填写被处置者可见的说明' });
    if (!value.content && !value.account)
      context.addIssue({ code: 'custom', path: ['content'], message: '请选择内容或账号处置' });
  });
export type ReportResolution = z.infer<typeof ReportResolutionSchema>;
export const ReportResolutionResultSchema = z.strictObject({
  content: z
    .strictObject({
      action: ReportContentActionSchema,
      resourceId: IdSchema,
      beforeRevision: z.number().int().positive(),
      afterRevision: z.number().int().positive(),
      recordId: IdSchema,
    })
    .nullable(),
  account: z
    .strictObject({
      userId: IdSchema,
      beforeSecurityVersion: z.number().int().positive(),
      afterSecurityVersion: z.number().int().positive(),
      recordId: IdSchema,
      revokedSessions: z.number().int().nonnegative(),
      affectedPersonas: z.number().int().nonnegative(),
    })
    .nullable(),
});
export type ReportResolutionResult = z.infer<typeof ReportResolutionResultSchema>;
export const ReportResolutionSummarySchema = z.strictObject({
  content: ReportContentActionSchema.nullable(),
  account: z.literal('ban').nullable(),
});
export const AdminReportActionSchema = z
  .strictObject({
    action: z.enum(['accept', 'resolve', 'dismiss', 'note']),
    message: multiline(0, 2000),
    privateNote: multiline(0, 5000),
    selfReviewConfirmed: z.boolean().default(false),
    confirmed: z.literal(true),
    resolution: ReportResolutionSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.resolution && value.action !== 'resolve')
      context.addIssue({
        code: 'custom',
        path: ['resolution'],
        message: '内容或账号处置只能随结案提交',
      });
    if (value.action !== 'note' && !value.message.trim())
      context.addIssue({
        code: 'custom',
        path: ['message'],
        message: '请填写举报人可见的处理说明',
      });
    if (value.action === 'note' && !value.message.trim() && !value.privateNote.trim())
      context.addIssue({ code: 'custom', path: ['message'], message: '请填写处理说明或内部备注' });
  });
export type AdminReportAction = z.infer<typeof AdminReportActionSchema>;
export function reportNextStatus(
  status: ReportStatus,
  action: AdminReportAction['action'],
): ReportStatus | null {
  if (action === 'note') return status;
  if (status !== 'pending' && status !== 'processing') return null;
  if (action === 'accept') return status === 'pending' ? 'processing' : null;
  return action === 'resolve' ? 'resolved' : 'dismissed';
}
const record = z.strictObject({
  id: IdSchema,
  action: z.enum(['submitted', 'accepted', 'resolved', 'dismissed', 'noted']),
  message: multiline(0, 2000),
  beforeStatus: ReportStatusSchema.nullable(),
  afterStatus: ReportStatusSchema,
  fromRevision: z.number().int().nonnegative(),
  toRevision: z.number().int().positive(),
  createdAt: TimestampSchema,
  resolution: ReportResolutionSummarySchema.nullable().default(null),
});
export const OwnReportRecordSchema = record.extend({ actor: z.enum(['you', 'administrator']) });
export const AdminReportRecordSchema = record.extend({
  actor: z.strictObject({ id: IdSchema, username: UsernameSchema }),
  privateNote: multiline(0, 5000),
  selfReview: z.boolean(),
  resolutionDetail: z
    .strictObject({ command: ReportResolutionSchema, result: ReportResolutionResultSchema })
    .nullable()
    .default(null),
});
export const OwnReportRecordsResponseSchema = z.strictObject({
  data: z.array(OwnReportRecordSchema).max(20),
  meta,
});
export const AdminReportRecordsResponseSchema = z.strictObject({
  data: z.array(AdminReportRecordSchema).max(20),
  meta,
});
export function reportEtag(id: string, revision: number) {
  return '"report-' + id.toLowerCase() + '-' + revision + '"';
}
