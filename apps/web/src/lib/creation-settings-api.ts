import {
  getCreationSettings,
  updateCreationSettings,
  getSubmissionSettingsRecords,
} from '@personamarket/api-client';
import {
  CreationSettingsResponseSchema,
  SubmissionSettingsRecordsResponseSchema,
  type CreationSettingsResponse,
  type CreationSettingsWrite,
  type SubmissionSettingsRecordsQuery,
} from '@personamarket/contracts';
import {
  ApiError,
  authenticatedWriteFor,
  checkedResponse,
  sessionRequestOptions,
} from './auth-api';
import { requestAuthSessionRefresh } from './auth-session-events';

export const creationSettingsKey = (accountId: string) =>
  ['private', 'settings', 'creation', accountId] as const;
const headers = (accountId: string) => ({ 'X-Expected-Account': accountId });
function failed(cause: unknown): never {
  if (cause instanceof ApiError) {
    if (['UNAUTHENTICATED', 'FORBIDDEN'].includes(cause.code)) requestAuthSessionRefresh();
    throw cause;
  }
  throw new Error('创作设置暂时无法读取或保存，请核对状态后重试', { cause });
}
export const creationSettingsApi = {
  read: (accountId: string, signal: AbortSignal) =>
    getCreationSettings({
      ...sessionRequestOptions,
      headers: headers(accountId),
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    })
      .then((result) => checkedResponse(result, CreationSettingsResponseSchema))
      .catch(failed),
  records: (accountId: string, input: SubmissionSettingsRecordsQuery, signal: AbortSignal) =>
    getSubmissionSettingsRecords({
      ...sessionRequestOptions,
      headers: headers(accountId),
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      params: { query: input },
    })
      .then((result) => checkedResponse(result, SubmissionSettingsRecordsResponseSchema))
      .catch(failed),
  write: (
    accountId: string,
    input: Omit<CreationSettingsWrite, 'reason'>,
    expected: CreationSettingsResponse['meta'],
    key: string,
  ) =>
    authenticatedWriteFor(
      accountId,
      (csrf) =>
        updateCreationSettings({
          ...sessionRequestOptions,
          headers: headers(accountId),
          signal: AbortSignal.timeout(10000),
          body: { ...input, expected },
          params: { header: { ...csrf, 'Idempotency-Key': key } },
        }),
      CreationSettingsResponseSchema,
      {
        accountChanged: '登录账号已变化，请重新确认创作设置',
        verificationRequired: '请先完成登录验证，再保存创作设置',
      },
    ).catch(failed),
};
