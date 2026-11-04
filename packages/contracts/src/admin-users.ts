import { z } from 'zod';

export const DeleteAdminUserSchema = z.strictObject({
  expectedSecurityVersion: z.number().int().positive(),
  mode: z.enum(['keep_anonymous', 'remove_content']),
  username: z.string().min(3).max(32),
});
import {
  AccountStatusSchema,
  DeactivationStatusSchema,
  EmailSchema,
  UserRoleSchema,
  UsernameSchema,
} from './auth.js';
import { IdSchema, TimestampSchema, textSchema } from './common.js';
import { PublicPersonaListResponseSchema } from './releases.js';

const CountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const SecurityVersionSchema = z.number().int().positive();
export const AdminUserContentQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(20).default(20),
});
export type AdminUserContentQuery = z.infer<typeof AdminUserContentQuerySchema>;
const AdminUserContentMetaSchema = z.strictObject({
  page: z.number().int().min(1).max(500),
  pageSize: z.number().int().min(1).max(20),
  total: CountSchema,
});
export const AdminUserPublicPersonasResponseSchema = PublicPersonaListResponseSchema.extend({
  data: PublicPersonaListResponseSchema.shape.data.max(20),
  meta: AdminUserContentMetaSchema.extend({
    capped: z.literal(false).default(false),
  }),
});
export const AdminUserReviewRecordsQuerySchema = AdminUserContentQuerySchema.extend({
  kind: z.enum(['all', 'persona', 'comment']).default('all'),
});
export type AdminUserReviewRecordsQuery = z.infer<typeof AdminUserReviewRecordsQuerySchema>;
const ReviewRecordBaseSchema = z.strictObject({
  id: IdSchema,
  actor: z.strictObject({ id: IdSchema, username: UsernameSchema }).nullable(),
  action: textSchema(1, 64),
  selfReview: z.boolean(),
  createdAt: TimestampSchema,
});
export const AdminUserReviewRecordSchema = z.discriminatedUnion('kind', [
  ReviewRecordBaseSchema.extend({
    kind: z.literal('persona'),
    personaId: IdSchema,
    submissionId: IdSchema.nullable(),
    reason: textSchema(0, 5000),
  }),
  ReviewRecordBaseSchema.extend({
    kind: z.literal('comment'),
    personaId: IdSchema,
    commentId: IdSchema,
    revisionId: IdSchema.nullable(),
    reason: textSchema(0, 2000),
  }),
]);
export const AdminUserReviewRecordsResponseSchema = z.strictObject({
  data: z.array(AdminUserReviewRecordSchema).max(20),
  meta: AdminUserContentMetaSchema,
});
const ManagementReasonSchema = textSchema(1, 2000).refine(
  (value) =>
    Array.from(value).every((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    }),
  '处理理由不能包含控制字符',
);
export const AdminUserIdSchema = z.strictObject({ id: IdSchema });
export const AdminUsersQuerySchema = z.strictObject({
  q: z
    .string()
    .trim()
    .max(160, '搜索内容过长')
    .refine((value) => !/\p{Cc}/u.test(value), '搜索不能包含控制字符')
    .default(''),
  role: z.enum(['all', 'user', 'moderator', 'admin']).default('all'),
  status: z.enum(['all', 'active', 'banned', 'deactivated']).default('all'),
  deactivation: z.enum(['all', 'pending']).default('all'),
  sort: z.enum(['newest', 'oldest', 'username']).default('newest'),
  page: z.coerce.number().int().min(1).max(2500).default(1),
  pageSize: z.coerce.number().int().min(1).max(20).default(20),
});
export type AdminUsersQuery = z.infer<typeof AdminUsersQuerySchema>;

export const AdminUserSummarySchema = z.strictObject({
  id: IdSchema,
  username: UsernameSchema,
  role: UserRoleSchema,
  status: AccountStatusSchema,
  emailVerified: z.boolean(),
  securityVersion: SecurityVersionSchema,
  personaCount: CountSchema,
  activeSessionCount: CountSchema,
  pendingDeactivation: z.boolean(),
  createdAt: TimestampSchema,
});
export const AdminUsersResponseSchema = z.strictObject({
  data: z.array(AdminUserSummarySchema).max(20),
  meta: z.strictObject({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive().max(20),
    total: CountSchema,
  }),
});
export const AdminUserActionSchema = z.enum(['set_role', 'ban', 'restore', 'revoke_sessions']);
export const AdminUserActionRecordSchema = z.strictObject({
  id: IdSchema,
  actor: z.strictObject({ id: IdSchema, username: UsernameSchema }),
  action: AdminUserActionSchema,
  reason: ManagementReasonSchema,
  fromRole: UserRoleSchema,
  toRole: UserRoleSchema,
  fromStatus: AccountStatusSchema,
  toStatus: AccountStatusSchema,
  scope: z.enum(['account_only', 'account_and_personas']),
  affectedPersonas: CountSchema,
  revokedSessions: CountSchema,
  createdAt: TimestampSchema,
});
export const AdminDeactivationDecisionSchema = z.strictObject({
  id: IdSchema,
  actor: z.strictObject({ id: IdSchema, username: UsernameSchema }),
  decision: z.enum(['approve', 'reject']),
  reason: ManagementReasonSchema,
  fromStatus: AccountStatusSchema,
  toStatus: AccountStatusSchema,
  fromSecurityVersion: SecurityVersionSchema,
  toSecurityVersion: SecurityVersionSchema,
  revokedSessions: CountSchema,
  createdAt: TimestampSchema,
});
export const AdminDeactivationRequestSchema = z.strictObject({
  id: IdSchema,
  status: DeactivationStatusSchema,
  reason: textSchema(1, 500),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  decision: AdminDeactivationDecisionSchema.nullable(),
});
export const AdminUserDetailSchema = AdminUserSummarySchema.extend({
  email: EmailSchema,
  mfaEnabled: z.boolean(),
  updatedAt: TimestampSchema,
  records: z.array(AdminUserActionRecordSchema).max(100),
  deactivationRequests: z.array(AdminDeactivationRequestSchema).max(100),
});
export const AdminUserResponseSchema = z.strictObject({ data: AdminUserDetailSchema });

const AdminUserWriteSchema = z.strictObject({
  expectedSecurityVersion: SecurityVersionSchema,
  reason: ManagementReasonSchema,
});
export const SetAdminUserRoleSchema = AdminUserWriteSchema.extend({ role: UserRoleSchema });
export const SetAdminUserStatusSchema = AdminUserWriteSchema.extend({
  status: z.enum(['banned', 'active']),
  scope: z.enum(['account_only', 'account_and_personas']).default('account_only'),
}).superRefine((value, context) => {
  if (value.status === 'active' && value.scope !== 'account_only')
    context.addIssue({
      code: 'custom',
      path: ['scope'],
      message: '恢复账号不自动恢复作品，请在作品管理中逐项核对',
    });
});
export const RevokeAdminUserSessionsSchema = AdminUserWriteSchema;
export const AdminDeactivationPathSchema = z.strictObject({ id: IdSchema, requestId: IdSchema });
export const ReviewDeactivationRequestSchema = AdminUserWriteSchema.extend({
  decision: z.enum(['approve', 'reject']),
});
