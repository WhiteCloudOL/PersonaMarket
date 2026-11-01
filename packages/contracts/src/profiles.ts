import { z } from 'zod';
import { IdSchema, TimestampSchema, PlatformSchema, textSchema } from './common.js';
import { UsernameSchema } from './auth.js';

const singleLine = (minimum: number, maximum: number) =>
  textSchema(minimum, maximum).refine(
    (value) => value === value.trim() && !/[\p{Cc}\uD800-\uDFFF]/u.test(value),
    '请使用不含控制字符或首尾空格的单行文字',
  );
const multiline = (minimum: number, maximum: number) =>
  textSchema(minimum, maximum).refine(
    (value) =>
      Array.from(value).every(
        (character) =>
          !/[\p{Cc}\uD800-\uDFFF]/u.test(character) || ['\t', '\r', '\n'].includes(character),
      ),
    '文字不能包含控制字符',
  );
function parsedUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export const ProfileLinkSchema = z.strictObject({
  label: singleLine(1, 40),
  url: z
    .string()
    .refine((value) => Array.from(value).length <= 2048, '链接过长')
    .refine(
      (value) => !/[\p{White_Space}\p{Cc}\uD800-\uDFFF\\]/u.test(value),
      '请使用不含空白、控制字符或反斜杠的完整网页链接',
    )
    // 先核验原始字符；URL解析可能先移除换行，不能让解析后的值掩盖非法输入
    .pipe(z.url({ protocol: /^https?$/ }))
    .refine((value) => {
      const parsed = parsedUrl(value);
      return parsed !== null && !parsed.username && !parsed.password;
    }, '公开链接不能包含登录凭据'),
});
export const ProfileContentSchema = z.strictObject({
  displayName: singleLine(1, 60),
  bio: multiline(0, 1000),
  // 头像只能引用本人上传的受控素材，不接收外部图片URL
  avatarAssetId: IdSchema.nullable(),
  links: z
    .array(ProfileLinkSchema)
    .max(5)
    .refine((links) => {
      // PostgreSQL jsonb::text 为两个键值和对象/数组分隔符加入固定空格
      const bytes =
        new TextEncoder().encode(JSON.stringify(links)).byteLength +
        Math.max(0, links.length * 4 - 1);
      return bytes <= 20000;
    }, '链接内容合计过长，请缩短链接或说明')
    .refine(
      (links) =>
        new Set(links.map((link) => parsedUrl(link.url)?.href ?? link.url)).size === links.length,
      '公开链接不能重复',
    ),
});
export type ProfileContent = z.infer<typeof ProfileContentSchema>;
export const SaveProfileSchema = z.strictObject({
  content: ProfileContentSchema,
  expectedRevision: z.number().int().nonnegative(),
});
export type SaveProfile = z.infer<typeof SaveProfileSchema>;
export const ProfileSubmissionStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
]);
export const ProfileVisibilitySchema = z.enum(['normal', 'hidden']);
export const ProfileSubmissionIdSchema = z.strictObject({ id: IdSchema });
export const CreatorParamsSchema = z.strictObject({ username: UsernameSchema });
export const CreatorAvatarParamsSchema = CreatorParamsSchema.extend({ id: IdSchema });
export const CreatorPersonasQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(20).default(12),
  platform: PlatformSchema.optional(),
  sort: z.enum(['newest', 'updated', 'oldest', 'title']).default('newest'),
});
export type CreatorPersonasQuery = z.infer<typeof CreatorPersonasQuerySchema>;
export const ProfileOwnerParamsSchema = z.strictObject({ userId: IdSchema });
export const SubmitProfileSchema = z.strictObject({
  expectedDraftRevision: z.number().int().positive(),
  confirmed: z.literal(true),
});
export type SubmitProfile = z.infer<typeof SubmitProfileSchema>;
export const WithdrawProfileSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  confirmed: z.literal(true),
});
export type WithdrawProfile = z.infer<typeof WithdrawProfileSchema>;
export const ReviewProfileSchema = z
  .strictObject({
    decision: z.enum(['approve', 'reject']),
    expectedRevision: z.number().int().positive(),
    reason: multiline(0, 2000).default(''),
    selfReviewConfirmed: z.boolean().default(false),
  })
  .superRefine((value, context) => {
    if (value.decision === 'reject' && !value.reason.trim())
      context.addIssue({ code: 'custom', path: ['reason'], message: '请填写驳回理由' });
  });
export type ReviewProfile = z.infer<typeof ReviewProfileSchema>;
export const SetProfileVisibilitySchema = z.strictObject({
  hidden: z.boolean(),
  expectedRevision: z.number().int().positive(),
  reason: multiline(1, 2000),
  selfReviewConfirmed: z.boolean().default(false),
});
export type SetProfileVisibility = z.infer<typeof SetProfileVisibilitySchema>;

export const ProfileSubmissionSchema = z.strictObject({
  id: IdSchema,
  userId: IdSchema,
  snapshot: ProfileContentSchema,
  draftRevision: z.number().int().positive(),
  revision: z.number().int().positive(),
  status: ProfileSubmissionStatusSchema,
  reason: multiline(0, 2000).nullable(),
  createdAt: TimestampSchema,
  reviewedAt: TimestampSchema.nullable(),
});
export type ProfileSubmission = z.infer<typeof ProfileSubmissionSchema>;
export const ProfileSubmissionResponseSchema = z.strictObject({ data: ProfileSubmissionSchema });
export const OwnProfileSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  content: ProfileContentSchema,
  updatedAt: TimestampSchema.nullable(),
  visibility: ProfileVisibilitySchema,
  moderationRevision: z.number().int().positive(),
  published: ProfileSubmissionSchema.nullable(),
  latestSubmission: ProfileSubmissionSchema.nullable(),
});
export type OwnProfile = z.infer<typeof OwnProfileSchema>;
export const OwnProfileResponseSchema = z.strictObject({ data: OwnProfileSchema });

const pagination = {
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(20).default(20),
};
const meta = z.strictObject({
  page: z.number().int().positive(),
  pageSize: z.number().int().min(1).max(20),
  total: z.number().int().nonnegative(),
});
export const ProfileHistoryQuerySchema = z.strictObject(pagination);
export type ProfileHistoryQuery = z.infer<typeof ProfileHistoryQuerySchema>;
export const ProfileHistoryResponseSchema = z.strictObject({
  data: z.array(ProfileSubmissionSchema).max(20),
  meta,
});
export const ProfileRecordSchema = z.strictObject({
  id: IdSchema,
  submissionId: IdSchema.nullable(),
  actor: z.strictObject({ id: IdSchema, username: UsernameSchema }),
  action: z.enum(['submit', 'withdraw', 'approve', 'reject', 'hide', 'restore']),
  reason: multiline(0, 2000),
  selfReview: z.boolean(),
  fromProfileRevision: z.number().int().positive(),
  toProfileRevision: z.number().int().positive(),
  createdAt: TimestampSchema,
});
export const ProfileRecordsResponseSchema = z.strictObject({
  data: z.array(ProfileRecordSchema).max(20),
  meta,
});
export const ProfileModerationQuerySchema = z.strictObject({
  ...pagination,
  status: z.enum(['all', ...ProfileSubmissionStatusSchema.options]).default('PENDING'),
  username: z.union([UsernameSchema, z.literal('')]).default(''),
});
export type ProfileModerationQuery = z.infer<typeof ProfileModerationQuerySchema>;
export const ModerationProfileSchema = ProfileSubmissionSchema.extend({
  owner: z.strictObject({ id: IdSchema, username: UsernameSchema }),
  currentProfile: z.strictObject({
    visibility: ProfileVisibilitySchema,
    revision: z.number().int().positive(),
    publishedSubmissionId: IdSchema.nullable(),
  }),
});
export type ModerationProfile = z.infer<typeof ModerationProfileSchema>;
export const ModerationProfileResponseSchema = z.strictObject({ data: ModerationProfileSchema });
export const ModerationProfilesResponseSchema = z.strictObject({
  data: z.array(ModerationProfileSchema).max(20),
  meta,
});
export const ProfileVisibilityResponseSchema = z.strictObject({
  data: z.strictObject({
    userId: IdSchema,
    visibility: ProfileVisibilitySchema,
    revision: z.number().int().positive(),
  }),
});

export const PublicCreatorSchema = z.strictObject({
  id: IdSchema,
  username: UsernameSchema,
  displayName: singleLine(1, 60),
  bio: multiline(0, 1000),
  links: z.array(ProfileLinkSchema).max(5),
  avatarUrl: z
    .string()
    .regex(/^\/api\/v1\/users\/[a-z][a-z0-9_]{2,31}\/avatar\/[a-f0-9-]{36}$/u)
    .refine((value) => IdSchema.safeParse(value.split('/').at(-1)).success, '头像版本无效')
    .nullable(),
  approvedRevisionId: IdSchema.nullable(),
  updatedAt: TimestampSchema.nullable(),
});
export type PublicCreator = z.infer<typeof PublicCreatorSchema>;
export const PublicCreatorResponseSchema = z.strictObject({ data: PublicCreatorSchema });
