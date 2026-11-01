import { expect, it } from 'vitest';
import {
  defaultSystemSettings,
  SystemSettingsSchema,
  SystemSettingsWriteSchema,
  MaintenanceMessageSchema,
  PublicSystemStatusResponseSchema,
  SystemRuntimeResponseSchema,
  SystemSettingsRecordsQuerySchema,
  systemSettingsEtag,
} from '@personamarket/contracts';
import { errorStatus, SystemConfigurationUnavailableError } from '@personamarket/server';

it('默认关闭，完整配置不接受可写运行环境、版本或任意字段', () => {
  expect(SystemSettingsSchema.parse(defaultSystemSettings)).toEqual({
    maintenanceEnabled: false,
    maintenanceMessage: '',
  });
  for (const data of [
    { maintenanceEnabled: false },
    { ...defaultSystemSettings, version: 'fake' },
    { ...defaultSystemSettings, databaseUrl: 'fixture' },
    { ...defaultSystemSettings, maintenanceEnabled: 'true' },
  ])
    expect(SystemSettingsSchema.safeParse(data).success).toBe(false);
});
it('公共提示按code point有界，保留正常纯文本换行，不接受纯空白或控制字符', () => {
  expect(MaintenanceMessageSchema.parse('')).toBe('');
  expect(MaintenanceMessageSchema.parse('  **稍后再试**\n第二行\t保留  ')).toBe(
    '  **稍后再试**\n第二行\t保留  ',
  );
  expect(MaintenanceMessageSchema.safeParse('🌟'.repeat(500)).success).toBe(true);
  for (const text of ['🌟'.repeat(501), ' \t\n', '维护\0提示'])
    expect(MaintenanceMessageSchema.safeParse(text).success).toBe(false);
});
it('高危完整写必须有理由与明确确认，不能写构建字段或默认免确认', () => {
  const input = { data: defaultSystemSettings, reason: '核对维护设置', confirmed: true };
  expect(SystemSettingsWriteSchema.parse(input)).toEqual(input);
  for (const value of [
    { ...input, confirmed: false },
    { data: input.data, reason: input.reason },
    { ...input, reason: ' ' },
    { ...input, reason: '🌟'.repeat(2001) },
    { ...input, sourceRevision: 'a'.repeat(40) },
  ])
    expect(SystemSettingsWriteSchema.safeParse(value).success).toBe(false);
});
it('公开白名单只有维护状态、公共提示和修订', () => {
  const input = { data: defaultSystemSettings, meta: { revision: 1 } };
  expect(PublicSystemStatusResponseSchema.parse(input)).toEqual(input);
  expect(
    PublicSystemStatusResponseSchema.safeParse({ ...input, defaults: defaultSystemSettings })
      .success,
  ).toBe(false);
  expect(
    PublicSystemStatusResponseSchema.safeParse({
      ...input,
      data: { ...input.data, reason: '私有理由' },
    }).success,
  ).toBe(false);
});
it('实际运行版本允许诚实unknown，不接受伪造component或路径秘密字段', () => {
  const input = {
    data: {
      component: 'api',
      nodeVersion: '24.22.1',
      build: {
        version: null,
        sourceRevision: null,
        sourceDirty: null,
        builtAt: null,
        status: 'unavailable',
      },
    },
  };
  expect(SystemRuntimeResponseSchema.parse(input)).toEqual(input);
  expect(
    SystemRuntimeResponseSchema.safeParse({ data: { ...input.data, component: 'all-services' } })
      .success,
  ).toBe(false);
  expect(
    SystemRuntimeResponseSchema.safeParse({
      data: { ...input.data, build: { ...input.data.build, sourceRevision: 'release-latest' } },
    }).success,
  ).toBe(false);
  expect(
    SystemRuntimeResponseSchema.safeParse({
      data: { ...input.data, storageRoot: '/private/fixture' },
    }).success,
  ).toBe(false);
});
it('历史分页有界，ETag绑定System修订且维护错误独立于配置不可用', () => {
  expect(SystemSettingsRecordsQuerySchema.parse({})).toEqual({ page: 1 });
  for (const page of [0, 101, 1.5])
    expect(SystemSettingsRecordsQuerySchema.safeParse({ page }).success).toBe(false);
  expect(systemSettingsEtag(12)).toBe('"system-12"');
  expect(errorStatus.MAINTENANCE_MODE).toBe(503);
  expect(new SystemConfigurationUnavailableError().code).toBe('SERVICE_UNAVAILABLE');
});
