import { z } from 'zod';
import { IdSchema, TimestampSchema, textSchema } from './common.js';
import { PublicRegistrationPolicySchema } from './account-policy.js';

export const UserRoleSchema = z.enum(['user', 'moderator', 'admin']);
export const AccountStatusSchema = z.enum(['active', 'banned', 'deactivated']);
export const AuthTokenPurposeSchema = z.enum(['email_verify', 'password_reset', 'email_change']);
export type UserRole = z.infer<typeof UserRoleSchema>;
export type AuthTokenPurpose = z.infer<typeof AuthTokenPurposeSchema>;

export const UsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_]{2,31}$/, '用户名需为 3 至 32 位字母、数字或下划线，并以字母开头');
export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: '请填写有效邮箱地址' }).max(254, '邮箱地址过长'));
// 保留原始密码，不裁剪、不改大小写，不要求特殊字符组合。
export const NewPasswordSchema = textSchema(12, 64);
// 32 随机字节的无填充 base64url；末位限制排除非规范编码。
export const OpaqueAuthTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/, '验证令牌格式不正确');
export const AuthTokenHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const EmailVerificationCodeSchema = z.string().regex(/^[0-9]{6}$/, '请输入 6 位邮箱验证码');
export const RequestRegistrationCodeSchema = z.strictObject({ email: EmailSchema });

export const AccountCredentialsSchema = z.strictObject({
  username: UsernameSchema,
  email: EmailSchema,
  password: NewPasswordSchema,
});
export const RegisterRequestSchema = AccountCredentialsSchema.extend({
  code: EmailVerificationCodeSchema,
});
export const LoginRequestSchema = z.strictObject({
  identifier: z.union([UsernameSchema, EmailSchema]),
  password: textSchema(1, 128),
});
export const ReauthenticateRequestSchema = z.strictObject({
  currentPassword: textSchema(1, 128),
});
export const VerifyEmailRequestSchema = z.strictObject({ token: OpaqueAuthTokenSchema });
export const ForgotPasswordRequestSchema = z.strictObject({ email: EmailSchema });
export const ResetPasswordRequestSchema = z.strictObject({
  token: OpaqueAuthTokenSchema,
  password: NewPasswordSchema,
});
export const SelfAccountSchema = z.strictObject({
  id: IdSchema,
  username: UsernameSchema,
  email: EmailSchema,
  emailVerified: z.boolean(),
  role: UserRoleSchema,
  status: AccountStatusSchema,
});
export const SessionSummarySchema = z.strictObject({
  id: IdSchema,
  createdAt: TimestampSchema,
  expiresAt: TimestampSchema,
  current: z.boolean(),
  deviceName: textSchema(0, 200),
});
export const AuthContextResponseSchema = z.strictObject({
  data: z.strictObject({
    csrfToken: AuthTokenHashSchema,
    account: SelfAccountSchema.nullable(),
    assurance: z.enum(['anonymous', 'authenticated', 'mfa_setup', 'mfa_required']),
    registrationAvailable: z.boolean(),
    registrationPolicy: PublicRegistrationPolicySchema,
    mfaEnabled: z.boolean(),
    sessionExpiresAt: TimestampSchema.nullable(),
  }),
});
export type AuthContextResponse = z.infer<typeof AuthContextResponseSchema>;
export const AuthNoticeResponseSchema = z.strictObject({
  data: z.strictObject({ message: z.string() }),
});
export const LoginResponseSchema = z.strictObject({
  data: AuthNoticeResponseSchema.shape.data.extend({
    assurance: z.enum(['authenticated', 'mfa_setup', 'mfa_required']),
  }),
});
export const AuthSessionsResponseSchema = z.strictObject({
  data: z.array(SessionSummarySchema).max(20),
});
export const MfaCodeRequestSchema = z.strictObject({
  code: z.string().regex(/^(?:[0-9]{6}|[A-Za-z0-9_-]{43})$/, '请输入六位验证码或恢复码'),
});
export const MfaSetupResponseSchema = z.strictObject({
  data: z.strictObject({ secret: z.string(), uri: z.string(), qrDataUrl: z.string() }),
});
export const MfaConfirmResponseSchema = z.strictObject({
  data: z.strictObject({ recoveryCodes: z.array(OpaqueAuthTokenSchema).length(10) }),
});
export const SessionIdParamsSchema = z.strictObject({ id: IdSchema });
export const ChangePasswordRequestSchema = z.strictObject({
  currentPassword: textSchema(1, 128),
  newPassword: NewPasswordSchema,
});
export const ChangeEmailRequestSchema = z.strictObject({
  currentPassword: textSchema(1, 128),
  email: EmailSchema,
});
export const ConfirmEmailChangeCodeSchema = ChangeEmailRequestSchema.extend({
  code: EmailVerificationCodeSchema,
});
export const DeactivationRequestSchema = z.strictObject({
  currentPassword: textSchema(1, 128),
  confirmation: z.literal('申请停用', { error: '请输入「申请停用」以确认' }),
  reason: textSchema(1, 500),
});
export const DeactivationStatusSchema = z.enum(['pending', 'withdrawn', 'approved', 'rejected']);
export const DeactivationResponseSchema = z.strictObject({
  data: z.strictObject({
    request: z
      .strictObject({
        id: IdSchema,
        status: DeactivationStatusSchema,
        reason: textSchema(1, 500),
        createdAt: TimestampSchema,
      })
      .nullable(),
  }),
});
