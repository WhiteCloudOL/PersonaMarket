import {
  getMediaSettings,
  getPublicMediaSettings,
  updateMediaSettings,
  getMediaSettingsRecords,
} from '@personamarket/api-client';
import {
  MediaSettingsResponseSchema,
  PublicMediaSettingsResponseSchema,
  MediaSettingsRecordsResponseSchema,
  mediaSettingsEtag,
  type MediaSettingsWrite,
  type MediaSettingsRecordsQuery,
} from '@personamarket/contracts';
import {
  ApiError,
  checkedResponse,
  authenticatedWriteFor,
  sessionRequestOptions,
} from './auth-api';
import { requestAuthSessionRefresh } from './auth-session-events';

export const mediaSettingsKey = (accountId: string) =>
  ['private', 'settings', 'media', accountId] as const;
const timeout = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(10000)]);
const headers = (accountId: string) => ({ 'X-Expected-Account': accountId });
function failed(cause: unknown): never {
  if (cause instanceof ApiError) {
    if (['UNAUTHENTICATED', 'FORBIDDEN'].includes(cause.code)) requestAuthSessionRefresh();
    throw cause;
  }
  throw new Error('文件与图片设置暂时无法读取或保存，请核对状态后重试', { cause });
}
export const mediaSettingsApi = {
  read: (accountId: string, signal: AbortSignal) =>
    getMediaSettings({
      ...sessionRequestOptions,
      headers: headers(accountId),
      signal: timeout(signal),
    })
      .then((result) => checkedResponse(result, MediaSettingsResponseSchema))
      .catch(failed),
  records: (accountId: string, input: MediaSettingsRecordsQuery, signal: AbortSignal) =>
    getMediaSettingsRecords({
      ...sessionRequestOptions,
      headers: headers(accountId),
      signal: timeout(signal),
      params: { query: input },
    })
      .then((result) => checkedResponse(result, MediaSettingsRecordsResponseSchema))
      .catch(failed),
  write: (
    accountId: string,
    input: Omit<MediaSettingsWrite, 'reason'>,
    revision: number,
    key: string,
  ) =>
    authenticatedWriteFor(
      accountId,
      (csrf) =>
        updateMediaSettings({
          ...sessionRequestOptions,
          headers: headers(accountId),
          signal: AbortSignal.timeout(10000),
          body: input,
          params: {
            header: { ...csrf, 'If-Match': mediaSettingsEtag(revision), 'Idempotency-Key': key },
          },
        }),
      MediaSettingsResponseSchema,
      {
        accountChanged: '登录账号已变化，请重新确认文件与图片设置',
        verificationRequired: '请先完成登录验证，再保存文件与图片设置',
      },
    ).catch(failed),
};

export const publicMediaSettingsQuery = {
  queryKey: ['public', 'settings', 'media'] as const,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    getPublicMediaSettings({ ...sessionRequestOptions, signal: timeout(signal) }).then((result) =>
      checkedResponse(result, PublicMediaSettingsResponseSchema),
    ),
  staleTime: 0,
  retry: false,
};
