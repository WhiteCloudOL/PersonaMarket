import {
  getHomeSettings,
  updateHomeSettings,
  getHomeSettingsRecords,
} from '@personamarket/api-client';
import {
  HomeSettingsResponseSchema,
  HomeSettingsRecordsResponseSchema,
  homeSettingsEtag,
  type HomeSettingsWrite,
  type HomeSettingsRecordsQuery,
} from '@personamarket/contracts';
import {
  ApiError,
  checkedResponse,
  authenticatedWriteFor,
  sessionRequestOptions,
} from './auth-api';
import { requestAuthSessionRefresh } from './auth-session-events';

export const homeSettingsKey = (accountId: string) =>
  ['private', 'settings', 'home', accountId] as const;
const timeout = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(10000)]);
const headers = (accountId: string) => ({ 'X-Expected-Account': accountId });
function failed(cause: unknown): never {
  if (cause instanceof ApiError) {
    if (['UNAUTHENTICATED', 'FORBIDDEN'].includes(cause.code)) requestAuthSessionRefresh();
    throw cause;
  }
  throw new Error('首页设置暂时无法读取或保存，请核对状态后重试', { cause });
}
export const homeSettingsApi = {
  read: (accountId: string, signal: AbortSignal) =>
    getHomeSettings({
      ...sessionRequestOptions,
      headers: headers(accountId),
      signal: timeout(signal),
    })
      .then((result) => checkedResponse(result, HomeSettingsResponseSchema))
      .catch(failed),
  records: (accountId: string, input: HomeSettingsRecordsQuery, signal: AbortSignal) =>
    getHomeSettingsRecords({
      ...sessionRequestOptions,
      headers: headers(accountId),
      signal: timeout(signal),
      params: { query: input },
    })
      .then((result) => checkedResponse(result, HomeSettingsRecordsResponseSchema))
      .catch(failed),
  write: (
    accountId: string,
    input: Omit<HomeSettingsWrite, 'reason'>,
    revision: number,
    key: string,
  ) =>
    authenticatedWriteFor(
      accountId,
      (csrf) =>
        updateHomeSettings({
          ...sessionRequestOptions,
          headers: headers(accountId),
          signal: AbortSignal.timeout(10000),
          body: input,
          params: {
            header: { ...csrf, 'If-Match': homeSettingsEtag(revision), 'Idempotency-Key': key },
          },
        }),
      HomeSettingsResponseSchema,
      {
        accountChanged: '登录账号已变化，请重新确认首页设置',
        verificationRequired: '请先完成登录验证，再保存首页设置',
      },
    ).catch(failed),
};
