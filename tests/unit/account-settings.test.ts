import { describe, expect, it } from 'vitest';
import {
  AccountSettingsSchema,
  AccountSettingsUpdateSchema,
  AccountSettingsWriteSchema,
  AccountSettingsRecordsQuerySchema,
  PublicRegistrationPolicySchema,
  RegistrationRateLimitSchema,
  accountSettingsEtag,
} from '@personamarket/contracts';
import {
  accountSettings,
  accountSettingsRecord,
  accountSettingsStoredRecord,
  parseServerEnvironment,
  registrationRateScope,
} from '@personamarket/server';
import { testEnvironment } from '../fixtures/environment.js';

const environment = parseServerEnvironment({
  ...testEnvironment(),
  AUTH_REGISTRATION_ENABLED: 'true',
  AUTH_SESSION_TTL_SECONDS: '7200',
});
const legacy = { registrationEnabled: null, sessionTtlSeconds: null };
const effective = accountSettings(legacy, environment);

describe('注册与账户策略', () => {
  it('旧null设置继续使用部署fallback，新增策略默认兼容原注册行为', () => {
    expect(effective).toEqual({
      registrationEnabled: true,
      sessionTtlSeconds: 7200,
      verificationEmailTiming: 'on_registration',
      registrationRateLimit: { maxAttempts: 10, windowSeconds: 3600 },
    });
    expect(
      accountSettings(
        { ...legacy, registrationEnabled: false, sessionTtlSeconds: 600 },
        environment,
      ),
    ).toMatchObject({ registrationEnabled: false, sessionTtlSeconds: 600 });
  });
  it('部分新策略逐成员补默认，而有效策略拒绝缺字段', () => {
    expect(
      accountSettings(
        {
          ...legacy,
          verificationEmailTiming: 'on_request',
          registrationRateLimit: { maxAttempts: 3 },
        },
        environment,
      ),
    ).toEqual({
      ...effective,
      verificationEmailTiming: 'on_request',
      registrationRateLimit: { maxAttempts: 3, windowSeconds: 3600 },
    });
    expect(AccountSettingsSchema.safeParse(legacy).success).toBe(false);
  });
  it.each([
    { maxAttempts: 0, windowSeconds: 60 },
    { maxAttempts: 11, windowSeconds: 3600 },
    { maxAttempts: 1.5, windowSeconds: 60 },
    { maxAttempts: 1, windowSeconds: 59 },
    { maxAttempts: 1, windowSeconds: 3601 },
    { maxAttempts: 1, windowSeconds: 60.5 },
    { maxAttempts: 1, windowSeconds: 60, revision: 7 },
  ])('业务限流拒绝超界、非整数与未声明字段：%j', (rate) => {
    expect(RegistrationRateLimitSchema.safeParse(rate).success).toBe(false);
  });
  it('窗口key不随设置修订、次数或其他策略变化，同窗口收紧沿用计数', () => {
    expect(registrationRateScope({ maxAttempts: 1, windowSeconds: 60 })).toBe(
      registrationRateScope({ maxAttempts: 10, windowSeconds: 60 }),
    );
    expect(registrationRateScope({ maxAttempts: 1, windowSeconds: 120 })).not.toBe(
      registrationRateScope({ maxAttempts: 1, windowSeconds: 60 }),
    );
    expect(registrationRateScope({ maxAttempts: 1, windowSeconds: 60 })).toBe(
      'registration-policy-ip:v1:w60',
    );
  });
  it('旧flat更新省略新字段不补默认，新客户端必须提交完整候选和理由', () => {
    const old = AccountSettingsUpdateSchema.parse({
      registrationEnabled: false,
      sessionTtlSeconds: 3600,
    });
    expect(old).toEqual({
      registrationEnabled: false,
      sessionTtlSeconds: 3600,
      reason: '更新注册与账户设置',
    });
    expect(
      AccountSettingsWriteSchema.safeParse({
        data: { registrationEnabled: true, sessionTtlSeconds: 3600 },
        reason: '保留旧客户端行为',
      }).success,
    ).toBe(false);
    expect(
      AccountSettingsWriteSchema.parse({ data: effective, reason: '核对注册策略' }).data,
    ).toEqual(effective);
  });
  it('理由按Unicode计数，拒绝空白和控制字符，允许可读换行', () => {
    for (const reason of ['', '  ', '原因\0无效', '🌟'.repeat(2001)])
      expect(AccountSettingsWriteSchema.safeParse({ data: effective, reason }).success).toBe(false);
    expect(
      AccountSettingsWriteSchema.parse({ data: effective, reason: '第一行\n第二行' }).reason,
    ).toBe('第一行\n第二行');
    expect(
      AccountSettingsWriteSchema.safeParse({ data: effective, reason: '🌟'.repeat(2000) }).success,
    ).toBe(true);
  });
  it('新历史冻结原始fallback与当时有效值，旧历史缺失字段保持未知', () => {
    expect(accountSettingsRecord(legacy, environment)).toEqual({
      stored: { ...legacy, verificationEmailTiming: null, registrationRateLimit: null },
      effective,
    });
    expect(
      accountSettingsStoredRecord({ ...legacy, registrationRateLimit: { windowSeconds: 120 } }),
    ).toEqual({
      ...legacy,
      verificationEmailTiming: null,
      registrationRateLimit: { maxAttempts: null, windowSeconds: 120 },
    });
  });
  it('公开引导仅允许时机和修订，不暴露限流、邮件或其他管理员设置', () => {
    const publicPolicy = { verificationEmailTiming: 'on_request', settingsRevision: 7 };
    expect(PublicRegistrationPolicySchema.parse(publicPolicy)).toEqual(publicPolicy);
    expect(
      PublicRegistrationPolicySchema.safeParse({
        ...publicPolicy,
        registrationRateLimit: effective.registrationRateLimit,
      }).success,
    ).toBe(false);
    expect(
      PublicRegistrationPolicySchema.safeParse({
        ...publicPolicy,
        smtpHost: 'mail.fixture.invalid',
      }).success,
    ).toBe(false);
  });
  it('历史分页有界，ETag绑定实际设置修订', () => {
    expect(AccountSettingsRecordsQuerySchema.parse({})).toEqual({ page: 1 });
    for (const page of [0, 101, 1.5])
      expect(AccountSettingsRecordsQuerySchema.safeParse({ page }).success).toBe(false);
    expect(accountSettingsEtag(12)).toBe('"accounts-12"');
  });
});
