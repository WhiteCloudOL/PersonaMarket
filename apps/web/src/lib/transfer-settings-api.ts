import {
  getTransferSettings,
  getPublicTransferSettings,
  updateTransferSettings,
  getTransferSettingsRecords,
} from '@personamarket/api-client';
import {
  TransferSettingsResponseSchema,
  PublicTransferSettingsResponseSchema,
  TransferSettingsRecordsResponseSchema,
  transferSettingsEtag,
  type TransferSettingsWrite,
  type TransferSettingsRecordsQuery,
} from '@personamarket/contracts';
import {
  ApiError,
  checkedResponse,
  authenticatedWriteFor,
  sessionRequestOptions,
} from './auth-api';
import { requestAuthSessionRefresh } from './auth-session-events';

export const transferSettingsKey = (accountId: string) =>
  ['private', 'settings', 'transfer', accountId] as const;
const timeout = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(10000)]);
const headers = (accountId: string) => ({ 'X-Expected-Account': accountId });
function failed(cause: unknown): never {
  if (cause instanceof ApiError) {
    if (['UNAUTHENTICATED', 'FORBIDDEN'].includes(cause.code)) requestAuthSessionRefresh();
    throw cause;
  }
  throw new Error('导入导出设置暂时无法读取或保存，请核对状态后重试', { cause });
}
export const transferSettingsApi = {
  read: (accountId: string, signal: AbortSignal) =>
    getTransferSettings({
      ...sessionRequestOptions,
      headers: headers(accountId),
      signal: timeout(signal),
    })
      .then((result) => checkedResponse(result, TransferSettingsResponseSchema))
      .catch(failed),
  records: (accountId: string, input: TransferSettingsRecordsQuery, signal: AbortSignal) =>
    getTransferSettingsRecords({
      ...sessionRequestOptions,
      headers: headers(accountId),
      signal: timeout(signal),
      params: { query: input },
    })
      .then((result) => checkedResponse(result, TransferSettingsRecordsResponseSchema))
      .catch(failed),
  write: (
    accountId: string,
    input: Omit<TransferSettingsWrite, 'reason'>,
    revision: number,
    key: string,
  ) =>
    authenticatedWriteFor(
      accountId,
      (csrf) =>
        updateTransferSettings({
          ...sessionRequestOptions,
          headers: headers(accountId),
          signal: AbortSignal.timeout(10000),
          body: input,
          params: {
            header: { ...csrf, 'If-Match': transferSettingsEtag(revision), 'Idempotency-Key': key },
          },
        }),
      TransferSettingsResponseSchema,
      {
        accountChanged: '登录账号已变化，请重新确认导入导出设置',
        verificationRequired: '请先完成登录验证，再保存导入导出设置',
      },
    ).catch(failed),
};

export const publicTransferSettingsQuery = {
  queryKey: ['public', 'settings', 'transfer'] as const,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    getPublicTransferSettings({ ...sessionRequestOptions, signal: timeout(signal) }).then(
      (result) => checkedResponse(result, PublicTransferSettingsResponseSchema),
    ),
  staleTime: 0,
  retry: false,
};
