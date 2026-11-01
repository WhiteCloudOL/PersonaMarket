import * as api from '@personamarket/api-client';
import {
  AdminRankingGenerationResponseSchema,
  AdminRankingRetryResponseSchema,
  AdminRankingRetryReceiptResponseSchema,
  type RetryAdminRankingGeneration,
} from '@personamarket/contracts';
import {
  ApiError,
  authenticatedWriteFor,
  checkedResponse,
  sessionRequestOptions,
} from './auth-api';
import { requestAuthSessionRefresh } from './auth-session-events';

function failed(cause: unknown): never {
  if (cause instanceof ApiError) {
    if (['UNAUTHENTICATED', 'FORBIDDEN'].includes(cause.code)) requestAuthSessionRefresh();
    throw cause;
  }
  throw new Error('排行任务暂时无法核对，原请求与输入已保留', { cause });
}
const expected = (accountId: string) => ({ 'X-Expected-Account': accountId });
const timeout = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(10000)]);
export const rankingTaskApi = {
  detail: (accountId: string, id: string, signal: AbortSignal) =>
    api
      .getAdminRankingGeneration({
        ...sessionRequestOptions,
        headers: expected(accountId),
        params: { path: { id } },
        signal: timeout(signal),
      })
      .then((result) => checkedResponse(result, AdminRankingGenerationResponseSchema))
      .catch(failed),
  retry: (accountId: string, id: string, body: RetryAdminRankingGeneration, key: string) =>
    authenticatedWriteFor(
      accountId,
      (csrf) =>
        api.retryAdminRankingGeneration({
          ...sessionRequestOptions,
          headers: expected(accountId),
          params: { path: { id }, header: { ...csrf, 'Idempotency-Key': key } },
          body,
          signal: AbortSignal.timeout(10000),
        }),
      AdminRankingRetryResponseSchema,
    ).catch(failed),
  receipt: (accountId: string, id: string, key: string, hash: string, signal: AbortSignal) =>
    api
      .getAdminRankingRetryReceipt({
        ...sessionRequestOptions,
        headers: expected(accountId),
        params: { path: { id }, header: { 'Idempotency-Key': key, 'X-Retry-Request-Hash': hash } },
        signal: timeout(signal),
      })
      .then((result) => checkedResponse(result, AdminRankingRetryReceiptResponseSchema))
      .catch(failed),
};
