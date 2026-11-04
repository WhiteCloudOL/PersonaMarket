import { z } from 'zod';
import { IdSchema, TimestampSchema, textSchema } from './common.js';
import { UsernameSchema } from './auth.js';

export const PolicySlugSchema = z.enum(['terms', 'privacy', 'content-policy']);
export type PolicySlug = z.infer<typeof PolicySlugSchema>;
export const PolicyParamsSchema = z.strictObject({ slug: PolicySlugSchema });
// 显式版本只核对当前公开指针，不开放历史正文读取
export const PolicyReadQuerySchema = z.strictObject({ publicationId: IdSchema.optional() });
export type PolicyReadQuery = z.infer<typeof PolicyReadQuerySchema>;
export const PolicySubmissionParamsSchema = PolicyParamsSchema.extend({ id: IdSchema });

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
const revision = z.number().int().positive();
const contentHash = z.string().regex(/^[a-f0-9]{64}$/);
const actor = z.strictObject({ id: IdSchema, username: UsernameSchema });
const reason = multiline(1, 2000);

// 草稿允许未完成；没有默认正文，送审时才要求标题和正文完整
export const PolicyDraftFieldsSchema = z.strictObject({
  title: line(0, 160),
  summary: line(0, 300),
  bodyMarkdown: multiline(0, 30000),
});
export type PolicyDraftFields = z.infer<typeof PolicyDraftFieldsSchema>;
export const PolicyFieldsSchema = PolicyDraftFieldsSchema.extend({
  title: line(1, 160),
  bodyMarkdown: multiline(1, 30000),
});
export type PolicyFields = z.infer<typeof PolicyFieldsSchema>;
export const PolicyWriteSchema = PolicyDraftFieldsSchema.extend({
  reason: reason.default('更新公共规则草稿'),
});
export type PolicyWrite = z.infer<typeof PolicyWriteSchema>;

// CAS、账号核对和幂等沿用 headers，不接受客户端指定作者、状态或公开正文
export const PolicyActionSchema = z.strictObject({
  reason,
  confirmed: z.literal(true),
});
export const SubmitPolicySchema = PolicyActionSchema;
export type SubmitPolicy = z.infer<typeof SubmitPolicySchema>;
export const WithdrawPolicySchema = PolicyActionSchema;
export type WithdrawPolicy = z.infer<typeof WithdrawPolicySchema>;
export const UnpublishPolicySchema = PolicyActionSchema;
export type UnpublishPolicy = z.infer<typeof UnpublishPolicySchema>;
export const ActivatePolicySchema = PolicyActionSchema.extend({ publicationId: IdSchema });
export type ActivatePolicy = z.infer<typeof ActivatePolicySchema>;

export const PolicyReviewDecisionSchema = z.enum(['approve', 'reject']);
export const ReviewPolicySchema = z
  .strictObject({
    decision: PolicyReviewDecisionSchema,
    reason: multiline(0, 2000).default(''),
    confirmed: z.literal(true),
    selfReviewConfirmed: z.boolean().default(false),
  })
  .superRefine((value, context) => {
    if ((value.decision === 'reject' || value.selfReviewConfirmed) && !value.reason.trim())
      context.addIssue({
        code: 'custom',
        path: ['reason'],
        message: value.selfReviewConfirmed ? '管理员自审需要明确理由' : '请填写驳回理由',
      });
  });
export type ReviewPolicy = z.infer<typeof ReviewPolicySchema>;

export const PolicySubmissionStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'withdrawn',
]);
export type PolicySubmissionStatus = z.infer<typeof PolicySubmissionStatusSchema>;
export function policyNextSubmissionStatus(
  status: PolicySubmissionStatus,
  action: 'withdraw' | z.infer<typeof PolicyReviewDecisionSchema>,
): PolicySubmissionStatus | null {
  if (status !== 'pending') return null;
  return action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'withdrawn';
}
export function policyEtag(slug: PolicySlug, value: number) {
  return '"policy-' + slug + '-' + value + '"';
}

// publicationId 是已获批 submission 的 UUID；不是另一份可编辑的正文
export const PublicPolicySchema = PolicyFieldsSchema.extend({
  slug: PolicySlugSchema,
  publicationId: IdSchema,
  publishedAt: TimestampSchema,
  activatedAt: TimestampSchema,
});
export type PublicPolicy = z.infer<typeof PublicPolicySchema>;
export const PublicPolicyResponseSchema = z.strictObject({ data: PublicPolicySchema });
export const PublicPolicySummarySchema = PublicPolicySchema.omit({ bodyMarkdown: true });
export const PublicPoliciesResponseSchema = z.strictObject({
  data: z.array(PublicPolicySummarySchema).max(3),
});

// 以下为管理员私有 DTO；内部完整作者谱系仍由服务端保存，不接受客户端回传
export const PolicySubmissionSummarySchema = z.strictObject({
  id: IdSchema,
  slug: PolicySlugSchema,
  sourceRevision: revision,
  contentHash,
  status: PolicySubmissionStatusSchema,
  submittedBy: actor,
  submittedAt: TimestampSchema,
  reviewedBy: actor.nullable(),
  reviewedAt: TimestampSchema.nullable(),
  // 实际历史自审结果，不因当前查看者变化而改写
  selfReview: z.boolean(),
  // 服务端按当前管理员及冻结谱系计算，仅 pending 可能为 true
  selfReviewRequired: z.boolean(),
});
export type PolicySubmissionSummary = z.infer<typeof PolicySubmissionSummarySchema>;
export const PolicySubmissionSchema = PolicySubmissionSummarySchema.extend({
  snapshot: PolicyFieldsSchema,
  reason: multiline(0, 2000).nullable(),
});
export type PolicySubmission = z.infer<typeof PolicySubmissionSchema>;
export const PolicySubmissionResponseSchema = z.strictObject({
  data: PolicySubmissionSchema,
  meta: z.strictObject({ revision }),
});

export const ManagedPolicySchema = PolicyDraftFieldsSchema.extend({
  slug: PolicySlugSchema,
  revision,
  updatedAt: TimestampSchema.nullable(),
  updatedBy: UsernameSchema.nullable(),
  published: PublicPolicySchema.nullable(),
  latestSubmission: PolicySubmissionSummarySchema.nullable(),
  hasUnpublishedChanges: z.boolean(),
});
export type ManagedPolicy = z.infer<typeof ManagedPolicySchema>;
export const AdminPolicyResponseSchema = z.strictObject({ data: ManagedPolicySchema });
export const AdminPolicySummarySchema = ManagedPolicySchema.omit({
  bodyMarkdown: true,
  published: true,
}).extend({
  publishedTitle: line(1, 160).nullable(),
  publishedAt: TimestampSchema.nullable(),
});
export const AdminPoliciesResponseSchema = z.strictObject({
  data: z.array(AdminPolicySummarySchema).max(3),
});

const page = {
  page: z.coerce.number().int().min(1).max(100).default(1),
};
const pageMeta = {
  page: z.number().int().positive(),
  pageSize: z.literal(20),
  total: z.number().int().nonnegative(),
};
export const PolicySubmissionsQuerySchema = z.strictObject({
  ...page,
  status: z.enum(['all', ...PolicySubmissionStatusSchema.options]).default('all'),
});
export type PolicySubmissionsQuery = z.infer<typeof PolicySubmissionsQuerySchema>;
export const PolicySubmissionsResponseSchema = z.strictObject({
  data: z.array(PolicySubmissionSummarySchema).max(20),
  meta: z.strictObject({ ...pageMeta, revision }),
});
export const PolicyRecordsQuerySchema = z.strictObject(page);
export type PolicyRecordsQuery = z.infer<typeof PolicyRecordsQuerySchema>;

export const PolicyRecordActionSchema = z.enum([
  'edited',
  'submitted',
  'approved',
  'rejected',
  'withdrawn',
  'unpublished',
  'activated',
]);
export const PolicyRecordSnapshotSchema = PolicyDraftFieldsSchema.extend({
  revision,
  contentHash,
  publishedId: IdSchema.nullable(),
  publishedContentHash: contentHash.nullable(),
  latestSubmissionId: IdSchema.nullable(),
  latestSubmissionStatus: PolicySubmissionStatusSchema.nullable(),
}).superRefine((value, context) => {
  if ((value.publishedId === null) !== (value.publishedContentHash === null))
    context.addIssue({
      code: 'custom',
      path: ['publishedId'],
      message: '公开版本与正文摘要必须同时存在或为空',
    });
  if ((value.latestSubmissionId === null) !== (value.latestSubmissionStatus === null))
    context.addIssue({
      code: 'custom',
      path: ['latestSubmissionId'],
      message: '送审版本与状态必须同时存在或为空',
    });
});
export const PolicyRecordSchema = z.strictObject({
  id: IdSchema,
  actor,
  action: PolicyRecordActionSchema,
  submissionId: IdSchema.nullable(),
  reason: multiline(0, 2000),
  selfReview: z.boolean(),
  before: PolicyRecordSnapshotSchema,
  after: PolicyRecordSnapshotSchema,
  createdAt: TimestampSchema,
});
export type PolicyRecord = z.infer<typeof PolicyRecordSchema>;
export const PolicyRecordResponseSchema = z.strictObject({ data: PolicyRecordSchema });
export const PolicyRecordSummarySchema = PolicyRecordSchema.omit({
  before: true,
  after: true,
}).extend({
  fromRevision: revision,
  toRevision: revision,
});
export type PolicyRecordSummary = z.infer<typeof PolicyRecordSummarySchema>;
export const PolicyRecordsResponseSchema = z.strictObject({
  data: z.array(PolicyRecordSummarySchema).max(20),
  meta: z.strictObject(pageMeta),
});
