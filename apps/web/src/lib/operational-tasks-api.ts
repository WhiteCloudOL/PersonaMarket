import * as api from '@personamarket/api-client';
import {
  OperationalTaskDetailResponseSchema,
  OperationalTaskActionResponseSchema,
  OperationalTaskReceiptResponseSchema,
  type OperationalTaskPath,
  type OperationalTaskCommand,
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
  throw new Error('任务核对暂时无法完成，原请求与输入已保留', { cause });
}
const expected = (accountId: string) => ({ 'X-Expected-Account': accountId });
const timeout = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(10000)]);
export const operationalTasksApi = {
  detail: (accountId: string, target: OperationalTaskPath, signal: AbortSignal) =>
    api
      .getOperationalTask({
        ...sessionRequestOptions,
        headers: expected(accountId),
        params: { path: target },
        signal: timeout(signal),
      })
      .then((result) => checkedResponse(result, OperationalTaskDetailResponseSchema))
      .catch(failed),
  handle: (
    accountId: string,
    target: OperationalTaskPath,
    body: OperationalTaskCommand,
    key: string,
  ) =>
    authenticatedWriteFor(
      accountId,
      (csrf) =>
        api.handleOperationalTask({
          ...sessionRequestOptions,
          headers: expected(accountId),
          params: { path: target, header: { ...csrf, 'Idempotency-Key': key } },
          body,
          signal: AbortSignal.timeout(10000),
        }),
      OperationalTaskActionResponseSchema,
    ).catch(failed),
  receipt: (
    accountId: string,
    target: OperationalTaskPath,
    key: string,
    hash: string,
    signal: AbortSignal,
  ) =>
    api
      .getOperationalTaskReceipt({
        ...sessionRequestOptions,
        headers: expected(accountId),
        params: { path: target, header: { 'Idempotency-Key': key, 'X-Retry-Request-Hash': hash } },
        signal: timeout(signal),
      })
      .then((result) => checkedResponse(result, OperationalTaskReceiptResponseSchema))
      .catch(failed),
};
