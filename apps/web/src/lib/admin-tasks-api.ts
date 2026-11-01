import {
  listAdminTaskFailures,
  getAdminTaskFailure,
  listAdminTaskRetries,
  retryAdminTask,
} from '@personamarket/api-client';
import {
  AdminTaskListResponseSchema,
  AdminTaskDetailResponseSchema,
  AdminTaskRetryHistoryResponseSchema,
  AdminTaskRetryResponseSchema,
  type AdminTaskQuery,
  type AdminTaskPath,
  type RetryAdminTask,
} from '@personamarket/contracts';
import {
  ApiError,
  authenticatedWriteFor,
  checkedResponse,
  sessionRequestOptions,
} from './auth-api';
import { requestAuthSessionRefresh } from './auth-session-events';

function taskError(cause: unknown): never {
  if (cause instanceof ApiError) {
    if (['UNAUTHENTICATED', 'FORBIDDEN'].includes(cause.code)) requestAuthSessionRefresh();
    throw cause;
  }
  throw new Error('任务服务暂时不可用，请核对结果后重试，当前输入已保留', { cause });
}
const taskHeaders = (accountId: string) => ({ 'X-Expected-Account': accountId });
export const adminTaskApi = {
  detail: (accountId: string, target: AdminTaskPath, signal: AbortSignal) =>
    getAdminTaskFailure({
      ...sessionRequestOptions,
      headers: taskHeaders(accountId),
      params: { path: target },
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    })
      .then((response) => checkedResponse(response, AdminTaskDetailResponseSchema))
      .catch(taskError),
  history: (accountId: string, target: AdminTaskPath, signal: AbortSignal) =>
    listAdminTaskRetries({
      ...sessionRequestOptions,
      headers: taskHeaders(accountId),
      params: { path: target },
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    })
      .then((response) => checkedResponse(response, AdminTaskRetryHistoryResponseSchema))
      .catch(taskError),
  retry: (accountId: string, target: AdminTaskPath, body: RetryAdminTask, key: string) =>
    authenticatedWriteFor(
      accountId,
      (csrf) =>
        retryAdminTask({
          ...sessionRequestOptions,
          headers: taskHeaders(accountId),
          params: { path: target, header: { ...csrf, 'Idempotency-Key': key } },
          body,
          signal: AbortSignal.timeout(10000),
        }),
      AdminTaskRetryResponseSchema,
      {
        accountChanged: '登录账号已变化，请重新核对任务',
        verificationRequired: '请先完成登录验证，再继续处理任务',
      },
    ).catch(taskError),
};

export async function readAdminTaskFailures(
  accountId: string,
  input: AdminTaskQuery,
  signal: AbortSignal,
) {
  try {
    return checkedResponse(
      await listAdminTaskFailures({
        ...sessionRequestOptions,
        params: { query: input },
        headers: { 'X-Expected-Account': accountId },
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      }),
      AdminTaskListResponseSchema,
    );
  } catch (cause) {
    if (cause instanceof ApiError) {
      if (['UNAUTHENTICATED', 'FORBIDDEN'].includes(cause.code)) requestAuthSessionRefresh();
      throw cause;
    }
    throw new Error('任务服务暂时不可用，请核对网络后重新读取', { cause });
  }
}
