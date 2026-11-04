import {
  getAccountSettings,
  updateAccountSettings,
  getAccountSettingsRecords,
} from '@personamarket/api-client';
import {
  AccountSettingsResponseSchema,
  AccountSettingsRecordsResponseSchema,
  accountSettingsEtag,
  type AccountSettingsWrite,
  type AccountSettingsResponse,
  type AccountSettingsRecordsQuery,
} from '@personamarket/contracts';
import {
  ApiError,
  authenticatedWriteFor,
  checkedResponse,
  sessionRequestOptions,
} from './auth-api';
import { requestAuthSessionRefresh } from './auth-session-events';

export const accountSettingsKey = (accountId: string) =>
  ['private', 'settings', 'accounts', accountId] as const;
const headers = (accountId: string) => ({ 'X-Expected-Account': accountId });
function failed(cause: unknown): never {
  if (cause instanceof ApiError) {
    if (['UNAUTHENTICATED', 'FORBIDDEN'].includes(cause.code)) requestAuthSessionRefresh();
    throw cause;
  }
  throw new Error('注册设置暂时无法读取或保存，请核对状态后重试', { cause });
}
export const accountSettingsApi = {
  read: (accountId: string, signal: AbortSignal) =>
    getAccountSettings({
      ...sessionRequestOptions,
      headers: headers(accountId),
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    })
      .then((result) => checkedResponse(result, AccountSettingsResponseSchema))
      .catch(failed),
  records: (accountId: string, input: AccountSettingsRecordsQuery, signal: AbortSignal) =>
    getAccountSettingsRecords({
      ...sessionRequestOptions,
      headers: headers(accountId),
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      params: { query: input },
    })
      .then((result) => checkedResponse(result, AccountSettingsRecordsResponseSchema))
      .catch(failed),
  write: (
    accountId: string,
    input: Omit<AccountSettingsWrite, 'reason'>,
    expected: AccountSettingsResponse['meta'],
    key: string,
  ) =>
    authenticatedWriteFor(
      accountId,
      (csrf) =>
        updateAccountSettings({
          ...sessionRequestOptions,
          headers: headers(accountId),
          signal: AbortSignal.timeout(10000),
          body: input,
          params: {
            header: {
              ...csrf,
              'If-Match': accountSettingsEtag(expected.revision),
              'Idempotency-Key': key,
            },
          },
        }),
      AccountSettingsResponseSchema,
      {
        accountChanged: '登录账号已变化，请重新确认注册设置',
        verificationRequired: '请先完成登录验证，再保存注册设置',
      },
    ).catch(failed),
};
