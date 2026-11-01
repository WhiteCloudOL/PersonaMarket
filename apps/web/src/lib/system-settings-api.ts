import {
  getSystemSettings,
  updateSystemSettings,
  getSystemSettingsRecords,
  getSystemRuntime,
  getReadiness,
} from '@personamarket/api-client';
import {
  SystemSettingsResponseSchema,
  SystemSettingsRecordsResponseSchema,
  SystemRuntimeResponseSchema,
  HealthResponseSchema,
  systemSettingsEtag,
  type SystemSettingsWrite,
  type SystemSettingsResponse,
  type SystemSettingsRecordsQuery,
} from '@personamarket/contracts';
import {
  ApiError,
  authenticatedWriteFor,
  checkedResponse,
  sessionRequestOptions,
} from './auth-api';
import { requestAuthSessionRefresh } from './auth-session-events';

export const systemSettingsKey = (accountId: string) =>
  ['private', 'settings', 'system', accountId] as const;
const headers = (accountId: string) => ({ 'X-Expected-Account': accountId });
function failed(cause: unknown): never {
  if (cause instanceof ApiError) {
    if (['UNAUTHENTICATED', 'FORBIDDEN'].includes(cause.code)) requestAuthSessionRefresh();
    throw cause;
  }
  throw new Error('系统信息暂时无法读取或保存，请核对状态后重试', { cause });
}
export const systemSettingsApi = {
  runtime: (accountId: string, signal: AbortSignal) =>
    getSystemRuntime({
      ...sessionRequestOptions,
      headers: headers(accountId),
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    })
      .then((result) => checkedResponse(result, SystemRuntimeResponseSchema))
      .catch(failed),
  readiness: (signal: AbortSignal) =>
    getReadiness({
      ...sessionRequestOptions,
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    })
      .then((result) => checkedResponse(result, HealthResponseSchema))
      .catch(failed),
  read: (accountId: string, signal: AbortSignal) =>
    getSystemSettings({
      ...sessionRequestOptions,
      headers: headers(accountId),
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    })
      .then((result) => checkedResponse(result, SystemSettingsResponseSchema))
      .catch(failed),
  records: (accountId: string, input: SystemSettingsRecordsQuery, signal: AbortSignal) =>
    getSystemSettingsRecords({
      ...sessionRequestOptions,
      headers: headers(accountId),
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      params: { query: input },
    })
      .then((result) => checkedResponse(result, SystemSettingsRecordsResponseSchema))
      .catch(failed),
  write: (
    accountId: string,
    input: SystemSettingsWrite,
    expected: SystemSettingsResponse['meta'],
    key: string,
  ) =>
    authenticatedWriteFor(
      accountId,
      (csrf) =>
        updateSystemSettings({
          ...sessionRequestOptions,
          headers: headers(accountId),
          signal: AbortSignal.timeout(10000),
          body: input,
          params: {
            header: {
              ...csrf,
              'If-Match': systemSettingsEtag(expected.revision),
              'Idempotency-Key': key,
            },
          },
        }),
      SystemSettingsResponseSchema,
      {
        accountChanged: '登录账号已变化，请重新确认维护设置',
        verificationRequired: '请先完成登录验证，再保存维护设置',
      },
    ).catch(failed),
};
