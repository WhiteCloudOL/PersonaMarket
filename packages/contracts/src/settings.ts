import { z } from 'zod';
import { EmailSchema, UsernameSchema } from './auth.js';
import { IdSchema, TimestampSchema, textSchema } from './common.js';
import { AccountSettingsSchema, AccountSettingsRecordValueSchema } from './account-policy.js';
export { AccountSettingsSchema, type AccountSettings } from './account-policy.js';

const clean = (max: number) =>
  z
    .string()
    .max(max)
    .regex(/^[^\r\n\0]*$/, '请移除换行或控制字符');
export const MailConnectionFieldsSchema = z.strictObject({
  host: z.union([z.hostname(), z.ipv4(), z.ipv6()]),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  from: EmailSchema,
  username: clean(254),
});
export const MailPasswordUpdateSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('keep') }),
  z.strictObject({ action: z.literal('clear') }),
  z.strictObject({
    action: z.literal('replace'),
    value: clean(1024).min(1, '请输入新的 SMTP 密码'),
  }),
]);
export const UpdateMailSettingsSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('environment') }),
  z.strictObject({ mode: z.literal('disabled') }),
  MailConnectionFieldsSchema.extend({
    mode: z.literal('custom'),
    password: MailPasswordUpdateSchema,
  }).strict(),
]);
export type UpdateMailSettings = z.infer<typeof UpdateMailSettingsSchema>;
export const MailSettingsResponseSchema = z.strictObject({
  data: z.strictObject({
    mode: z.enum(['environment', 'custom', 'disabled']),
    host: z.string(),
    port: z.number().int(),
    secure: z.boolean(),
    from: z.string(),
    username: z.string(),
    passwordConfigured: z.boolean(),
    configured: z.boolean(),
    updatedAt: TimestampSchema,
  }),
  meta: z.strictObject({ revision: z.number().int().positive() }),
});
export type MailSettingsResponse = z.infer<typeof MailSettingsResponseSchema>;
export const AccountSettingsResponseSchema = z.strictObject({
  data: AccountSettingsSchema,
  defaults: AccountSettingsSchema,
  meta: z.strictObject({ revision: z.number().int().positive() }),
});
export type AccountSettingsResponse = z.infer<typeof AccountSettingsResponseSchema>;
const accountReason = textSchema(1, 2000).refine(
  (value) =>
    Array.from(value).every(
      (character) => !/\p{Cc}/u.test(character) || ['\t', '\r', '\n'].includes(character),
    ),
  '处理理由不能包含控制字符',
);
export const AccountSettingsWriteSchema = z.strictObject({
  data: AccountSettingsSchema,
  reason: accountReason.default('更新注册与账户设置'),
});
export type AccountSettingsWrite = z.infer<typeof AccountSettingsWriteSchema>;
// 旧flat载荷只保留省略的新字段，不能在契约层补默认覆盖管理员当前策略。
export const AccountSettingsLegacyUpdateSchema = AccountSettingsSchema.partial({
  verificationEmailTiming: true,
  registrationRateLimit: true,
}).extend({ reason: accountReason.default('更新注册与账户设置') });
export const AccountSettingsUpdateSchema = z.union([
  AccountSettingsWriteSchema,
  AccountSettingsLegacyUpdateSchema,
]);
export type AccountSettingsUpdate = z.infer<typeof AccountSettingsUpdateSchema>;
export const AccountSettingsRecordsQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(100).default(1),
});
export type AccountSettingsRecordsQuery = z.infer<typeof AccountSettingsRecordsQuerySchema>;
export const AccountSettingsRecordsResponseSchema = z.strictObject({
  data: z
    .array(
      z.strictObject({
        id: IdSchema,
        actor: UsernameSchema,
        reason: accountReason,
        before: AccountSettingsRecordValueSchema,
        after: AccountSettingsRecordValueSchema,
        fromRevision: z.number().int().positive(),
        toRevision: z.number().int().positive(),
        createdAt: TimestampSchema,
      }),
    )
    .max(20),
  meta: z.strictObject({
    page: z.number().int().positive(),
    pageSize: z.literal(20),
    total: z.number().int().nonnegative(),
  }),
});
export type AccountSettingsRecordsResponse = z.infer<typeof AccountSettingsRecordsResponseSchema>;
// 收件人固定为当前管理员已验证邮箱，不接受任意收件人或正文。
export const MailTestResponseSchema = z.strictObject({
  data: z.strictObject({ message: z.string(), recipient: EmailSchema }),
});
export const EmptySettingsRequestSchema = z.strictObject({});
