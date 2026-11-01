import { z } from 'zod';

// 保持纯依赖：auth需要公开引导，settings本身又引用auth的邮箱/用户名契约。
export const VerificationEmailTimingSchema = z.enum(['on_registration', 'on_request']);
export type VerificationEmailTiming = z.infer<typeof VerificationEmailTimingSchema>;
export const RegistrationRateLimitSchema = z.strictObject({
  maxAttempts: z
    .number({ error: '请输入注册尝试次数' })
    .int('尝试次数必须为整数')
    .min(1, '尝试次数至少为1次')
    .max(10, '尝试次数不能超过10次'),
  windowSeconds: z
    .number({ error: '请输入限流窗口秒数' })
    .int('窗口秒数必须为整数')
    .min(60, '窗口至少为60秒')
    .max(3600, '窗口不能超过3600秒'),
});
export type RegistrationRateLimit = z.infer<typeof RegistrationRateLimitSchema>;
export const defaultVerificationEmailTiming = 'on_registration' as const;
export const defaultRegistrationRateLimit = { maxAttempts: 10, windowSeconds: 3600 } as const;
export const AccountSettingsSchema = z.strictObject({
  registrationEnabled: z.boolean(),
  sessionTtlSeconds: z
    .number({ error: '请输入新会话有效期秒数' })
    .int('有效期必须为整数秒')
    .min(600, '新会话有效期至少为600秒')
    .max(604800, '新会话有效期不能超过604800秒'),
  verificationEmailTiming: VerificationEmailTimingSchema,
  registrationRateLimit: RegistrationRateLimitSchema,
});
export type AccountSettings = z.infer<typeof AccountSettingsSchema>;
export const PublicRegistrationPolicySchema = z.strictObject({
  verificationEmailTiming: VerificationEmailTimingSchema,
  settingsRevision: z.number().int().positive(),
});
export const AccountSettingsStoredRecordSchema = z.strictObject({
  registrationEnabled: z.boolean().nullable(),
  sessionTtlSeconds: AccountSettingsSchema.shape.sessionTtlSeconds.nullable(),
  verificationEmailTiming: VerificationEmailTimingSchema.nullable(),
  registrationRateLimit: z
    .strictObject({
      maxAttempts: RegistrationRateLimitSchema.shape.maxAttempts.nullable(),
      windowSeconds: RegistrationRateLimitSchema.shape.windowSeconds.nullable(),
    })
    .nullable(),
});
export const AccountSettingsRecordValueSchema = z.strictObject({
  stored: AccountSettingsStoredRecordSchema,
  effective: AccountSettingsSchema.nullable(),
});
export type AccountSettingsRecordValue = z.infer<typeof AccountSettingsRecordValueSchema>;
export function accountSettingsEtag(revision: number) {
  return '"accounts-' + revision + '"';
}
