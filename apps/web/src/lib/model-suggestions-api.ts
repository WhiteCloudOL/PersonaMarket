import {
  getModelSuggestions,
  getPublicModelSuggestions,
  updateModelSuggestions,
  getModelSuggestionsRecords,
} from '@personamarket/api-client';
import {
  ModelSuggestionsResponseSchema,
  PublicModelSuggestionsResponseSchema,
  ModelSuggestionsRecordsResponseSchema,
  modelSuggestionsEtag,
  type ModelSuggestionsWrite,
  type ModelSuggestionsRecordsQuery,
} from '@personamarket/contracts';
import {
  ApiError,
  checkedResponse,
  authenticatedWriteFor,
  sessionRequestOptions,
} from './auth-api';
import { requestAuthSessionRefresh } from './auth-session-events';

export const modelSuggestionsKey = (accountId: string) =>
  ['private', 'settings', 'model-suggestions', accountId] as const;
const timeout = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(10000)]);
const headers = (accountId: string) => ({ 'X-Expected-Account': accountId });
function failed(cause: unknown): never {
  if (cause instanceof ApiError) {
    if (['UNAUTHENTICATED', 'FORBIDDEN'].includes(cause.code)) requestAuthSessionRefresh();
    throw cause;
  }
  throw new Error('模型建议暂时无法读取或保存，请核对状态后重试', { cause });
}
export const modelSuggestionsApi = {
  read: (accountId: string, signal: AbortSignal) =>
    getModelSuggestions({
      ...sessionRequestOptions,
      headers: headers(accountId),
      signal: timeout(signal),
    })
      .then((result) => checkedResponse(result, ModelSuggestionsResponseSchema))
      .catch(failed),
  records: (accountId: string, input: ModelSuggestionsRecordsQuery, signal: AbortSignal) =>
    getModelSuggestionsRecords({
      ...sessionRequestOptions,
      headers: headers(accountId),
      signal: timeout(signal),
      params: { query: input },
    })
      .then((result) => checkedResponse(result, ModelSuggestionsRecordsResponseSchema))
      .catch(failed),
  write: (
    accountId: string,
    input: Omit<ModelSuggestionsWrite, 'reason'>,
    revision: number,
    key: string,
  ) =>
    authenticatedWriteFor(
      accountId,
      (csrf) =>
        updateModelSuggestions({
          ...sessionRequestOptions,
          headers: headers(accountId),
          signal: AbortSignal.timeout(10000),
          body: input,
          params: {
            header: { ...csrf, 'If-Match': modelSuggestionsEtag(revision), 'Idempotency-Key': key },
          },
        }),
      ModelSuggestionsResponseSchema,
      {
        accountChanged: '登录账号已变化，请重新确认模型建议',
        verificationRequired: '请先完成登录验证，再保存模型建议',
      },
    ).catch(failed),
};

export const publicModelSuggestionsQuery = {
  queryKey: ['site', 'model-suggestions'],
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    getPublicModelSuggestions({
      cache: 'no-store',
      credentials: 'omit',
      signal: timeout(signal),
    })
      .then((response) => checkedResponse(response, PublicModelSuggestionsResponseSchema))
      .catch(failed),
  retry: false,
};
