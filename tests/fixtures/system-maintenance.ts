import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import {
  SystemSettingsResponseSchema,
  ErrorResponseSchema,
  systemSettingsEtag,
} from '@personamarket/contracts';
import type { AuthHttp } from './auth-http.js';

export async function readSystemSettingsHttp(http: AuthHttp) {
  const response = await http.raw('/api/v1/admin/settings/system');
  expect(response.status).toBe(200);
  const result = SystemSettingsResponseSchema.parse(await response.json());
  expect(response.headers.get('etag')).toBe(systemSettingsEtag(result.meta.revision));
  expect(response.headers.get('cache-control')).toContain('no-store');
  return result;
}
export async function setMaintenance(
  http: AuthHttp,
  maintenanceEnabled: boolean,
  maintenanceMessage = '',
) {
  const current = await readSystemSettingsHttp(http),
    account = (await http.context()).data.account;
  if (!account) throw new Error('缺少隔离管理员身份');
  const input = {
    data: { maintenanceEnabled, maintenanceMessage },
    reason: '隔离正常业务验收维护开关',
    confirmed: true as const,
  };
  const headers = {
    'If-Match': systemSettingsEtag(current.meta.revision),
    'Idempotency-Key': randomUUID(),
    'X-Expected-Account': account.id,
  };
  const response = await http.write('/api/v1/admin/settings/system', input, 'PATCH', headers);
  expect(response.status).toBe(200);
  return { input, headers, result: SystemSettingsResponseSchema.parse(await response.json()) };
}
export async function expectMaintenance(response: Response) {
  expect(response.status).toBe(503);
  expect(response.headers.get('retry-after')).toBe('60');
  const result = ErrorResponseSchema.parse(await response.json());
  expect(result.error.code).toBe('MAINTENANCE_MODE');
  return result;
}
