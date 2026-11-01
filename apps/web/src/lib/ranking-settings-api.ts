import {
  getRankingSettings,
  updateRankingSettings,
  getRankingSettingsRecords,
  getRankingRuntime,
} from '@personamarket/api-client';
import {
  RankingSettingsResponseSchema,
  RankingSettingsRecordsResponseSchema,
  RankingRuntimeResponseSchema,
  rankingSettingsEtag,
  type RankingSettingsWrite,
  type RankingSettingsRecordsQuery,
} from '@personamarket/contracts';
import {
  ApiError,
  checkedResponse,
  authenticatedWriteFor,
  sessionRequestOptions,
} from './auth-api';
import { requestAuthSessionRefresh } from './auth-session-events';

export const rankingSettingsKey = (accountId: string) =>
  ['private', 'settings', 'rankings', accountId] as const;
const timeout = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(10000)]);
const headers = (accountId: string) => ({ 'X-Expected-Account': accountId });
function failed(cause: unknown): never {
  if (cause instanceof ApiError) {
    if (['UNAUTHENTICATED', 'FORBIDDEN'].includes(cause.code)) requestAuthSessionRefresh();
    throw cause;
  }
  throw new Error('排行与运营设置暂时无法读取或保存，请核对状态后重试', { cause });
}
export const rankingSettingsApi = {
  runtime: (accountId: string, signal: AbortSignal) =>
    getRankingRuntime({
      ...sessionRequestOptions,
      headers: headers(accountId),
      signal: timeout(signal),
    })
      .then((result) => checkedResponse(result, RankingRuntimeResponseSchema))
      .catch(failed),
  read: (accountId: string, signal: AbortSignal) =>
    getRankingSettings({
      ...sessionRequestOptions,
      headers: headers(accountId),
      signal: timeout(signal),
    })
      .then((result) => checkedResponse(result, RankingSettingsResponseSchema))
      .catch(failed),
  records: (accountId: string, input: RankingSettingsRecordsQuery, signal: AbortSignal) =>
    getRankingSettingsRecords({
      ...sessionRequestOptions,
      headers: headers(accountId),
      signal: timeout(signal),
      params: { query: input },
    })
      .then((result) => checkedResponse(result, RankingSettingsRecordsResponseSchema))
      .catch(failed),
  write: (accountId: string, input: RankingSettingsWrite, revision: number, key: string) =>
    authenticatedWriteFor(
      accountId,
      (csrf) =>
        updateRankingSettings({
          ...sessionRequestOptions,
          headers: headers(accountId),
          signal: AbortSignal.timeout(10000),
          body: input,
          params: {
            header: { ...csrf, 'If-Match': rankingSettingsEtag(revision), 'Idempotency-Key': key },
          },
        }),
      RankingSettingsResponseSchema,
      {
        accountChanged: '登录账号已变化，请重新确认排行与运营设置',
        verificationRequired: '请先完成登录验证，再保存排行与运营设置',
      },
    ).catch(failed),
};
