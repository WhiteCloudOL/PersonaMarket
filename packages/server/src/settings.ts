import {
  AccountSettingsSchema,
  AccountSettingsRecordValueSchema,
  RegistrationRateLimitSchema,
  VerificationEmailTimingSchema,
  defaultVerificationEmailTiming,
  defaultRegistrationRateLimit,
  MailConnectionFieldsSchema,
  type MailSettingsResponse,
  type UpdateMailSettings,
} from '@personamarket/contracts';
import type { Database } from '@personamarket/database';
import { z } from 'zod';
import { BusinessError } from './errors.js';
import { openSecret, sealSecret } from './encryption.js';
import type { ServerEnvironment } from './env.js';

export const StoredMailSettingsSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('environment') }),
  z.strictObject({ mode: z.literal('disabled') }),
  MailConnectionFieldsSchema.extend({
    mode: z.literal('custom'),
    encryptedPassword: z.string().min(1).nullable(),
  }).strict(),
]);
export const StoredAccountSettingsSchema = z.strictObject({
  registrationEnabled: z.boolean().nullable(),
  sessionTtlSeconds: z.number().int().min(600).max(604800).nullable(),
  verificationEmailTiming: VerificationEmailTimingSchema.optional(),
  registrationRateLimit: RegistrationRateLimitSchema.partial().optional(),
});
export type MailConnection = z.infer<typeof MailConnectionFieldsSchema> & { password: string };
export function environmentMail(env: ServerEnvironment): MailConnection | undefined {
  return env.SMTP_HOST
    ? {
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        from: env.SMTP_FROM,
        username: env.SMTP_USER ?? '',
        password: env.SMTP_PASSWORD ?? '',
      }
    : undefined;
}
export function accountSettings(value: unknown, env: ServerEnvironment) {
  const parsed = StoredAccountSettingsSchema.parse(value);
  return AccountSettingsSchema.parse({
    registrationEnabled: parsed.registrationEnabled ?? env.AUTH_REGISTRATION_ENABLED,
    sessionTtlSeconds: parsed.sessionTtlSeconds ?? env.AUTH_SESSION_TTL_SECONDS,
    verificationEmailTiming: parsed.verificationEmailTiming ?? defaultVerificationEmailTiming,
    registrationRateLimit: { ...defaultRegistrationRateLimit, ...parsed.registrationRateLimit },
  });
}
export function accountSettingsStoredRecord(value: unknown) {
  const stored = StoredAccountSettingsSchema.parse(value);
  return {
    registrationEnabled: stored.registrationEnabled,
    sessionTtlSeconds: stored.sessionTtlSeconds,
    verificationEmailTiming: stored.verificationEmailTiming ?? null,
    registrationRateLimit: stored.registrationRateLimit
      ? {
          maxAttempts: stored.registrationRateLimit.maxAttempts ?? null,
          windowSeconds: stored.registrationRateLimit.windowSeconds ?? null,
        }
      : null,
  };
}
export function accountSettingsRecord(value: unknown, env: ServerEnvironment) {
  return AccountSettingsRecordValueSchema.parse({
    stored: accountSettingsStoredRecord(value),
    effective: accountSettings(value, env),
  });
}
export function updatedMailSettings(input: UpdateMailSettings, previous: unknown, key: string) {
  if (input.mode !== 'custom') return StoredMailSettingsSchema.parse(input);
  const old = StoredMailSettingsSchema.parse(previous);
  const encryptedPassword =
    input.password.action === 'replace'
      ? sealSecret(key, 'settings:mail:password', input.password.value)
      : input.password.action === 'clear'
        ? null
        : old.mode === 'custom'
          ? old.encryptedPassword
          : null;
  if (Boolean(input.username) !== Boolean(encryptedPassword))
    throw new BusinessError('INVALID_INPUT', 'SMTP 账号和密码必须同时配置或同时清除');
  return StoredMailSettingsSchema.parse({
    mode: input.mode,
    host: input.host,
    port: input.port,
    secure: input.secure,
    from: input.from,
    username: input.username,
    encryptedPassword,
  });
}
export class MailConfigurationStore {
  constructor(
    private readonly database: Database,
    private readonly env: ServerEnvironment,
  ) {}
  async read() {
    const row = await this.database.db.query.siteSettings.findFirst({
      where: (settings, { eq }) => eq(settings.key, 'mail'),
    });
    if (!row) throw new Error('MAIL_SETTINGS_MISSING');
    const stored = StoredMailSettingsSchema.parse(row.value);
    const connection =
      stored.mode === 'disabled'
        ? undefined
        : stored.mode === 'environment'
          ? environmentMail(this.env)
          : {
              host: stored.host,
              port: stored.port,
              secure: stored.secure,
              from: stored.from,
              username: stored.username,
              password: stored.encryptedPassword
                ? openSecret(
                    this.env.APP_ENCRYPTION_KEY,
                    'settings:mail:password',
                    stored.encryptedPassword,
                  )
                : '',
            };
    return { row, stored, connection };
  }
  async current() {
    return (await this.read()).connection;
  }
  async publicRead(): Promise<MailSettingsResponse> {
    const { row, stored, connection } = await this.read();
    return {
      data: {
        mode: stored.mode,
        host: connection?.host ?? '',
        port: connection?.port ?? 587,
        secure: connection?.secure ?? false,
        from: connection?.from ?? '',
        username: connection?.username ?? '',
        passwordConfigured: Boolean(connection?.password),
        configured: Boolean(connection),
        updatedAt: row.updatedAt.toISOString(),
      },
      meta: { revision: row.revision },
    };
  }
}
export async function readAccountSettings(database: Database, env: ServerEnvironment) {
  const row = await database.db.query.siteSettings.findFirst({
    where: (settings, { eq }) => eq(settings.key, 'accounts'),
  });
  if (!row) throw new Error('ACCOUNT_SETTINGS_MISSING');
  return {
    data: accountSettings(row.value, env),
    defaults: {
      registrationEnabled: env.AUTH_REGISTRATION_ENABLED,
      sessionTtlSeconds: env.AUTH_SESSION_TTL_SECONDS,
      verificationEmailTiming: defaultVerificationEmailTiming,
      registrationRateLimit: { ...defaultRegistrationRateLimit },
    },
    meta: { revision: row.revision },
  };
}
