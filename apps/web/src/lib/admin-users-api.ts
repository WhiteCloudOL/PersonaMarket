import {
  getAdminUser,
  getAdminUsers,
  revokeAdminUserSessions,
  setAdminUserRole,
  setAdminUserStatus,
  reviewDeactivationRequest,
  getAdminUserPublicPersonas,
  getAdminUserReviewRecords,
} from '@personamarket/api-client';
import {
  AdminUserResponseSchema,
  AdminUsersResponseSchema,
  type AdminUsersQuery,
  type RevokeAdminUserSessionsSchema,
  type SetAdminUserRoleSchema,
  type SetAdminUserStatusSchema,
  type ReviewDeactivationRequestSchema,
  AdminUserPublicPersonasResponseSchema,
  AdminUserReviewRecordsResponseSchema,
  type AdminUserContentQuery,
  type AdminUserReviewRecordsQuery,
} from '@personamarket/contracts';
import type { z } from 'zod';
import { requestAuthSessionRefresh } from './auth-session-events';
import {
  ApiError,
  authenticatedWriteFor,
  checkedResponse,
  sessionRequestOptions,
} from './auth-api';

export const adminUsersKey = (accountId: string) => ['private', 'admin-users', accountId] as const;
const expected = (accountId: string) => ({ 'X-Expected-Account': accountId });
const timeout = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(10000)]);
const messages = {
  accountChanged: '登录账号已变化，请重新确认管理操作',
  verificationRequired: '请先完成登录验证，再继续管理操作',
};
function failed(cause: unknown): never {
  if (cause instanceof ApiError) {
    if (['UNAUTHENTICATED', 'FORBIDDEN'].includes(cause.code)) requestAuthSessionRefresh();
    throw cause;
  }
  throw new Error('用户管理服务暂时不可用，请稍后重试', { cause });
}
export const adminUsersApi = {
  publicPersonas: (
    accountId: string,
    id: string,
    query: AdminUserContentQuery,
    signal: AbortSignal,
  ) =>
    getAdminUserPublicPersonas({
      ...sessionRequestOptions,
      headers: expected(accountId),
      params: { path: { id }, query },
      signal: timeout(signal),
    })
      .then((response) => checkedResponse(response, AdminUserPublicPersonasResponseSchema))
      .catch(failed),
  reviewRecords: (
    accountId: string,
    id: string,
    query: AdminUserReviewRecordsQuery,
    signal: AbortSignal,
  ) =>
    getAdminUserReviewRecords({
      ...sessionRequestOptions,
      headers: expected(accountId),
      params: { path: { id }, query },
      signal: timeout(signal),
    })
      .then((response) => checkedResponse(response, AdminUserReviewRecordsResponseSchema))
      .catch(failed),
  deactivation: (
    accountId: string,
    id: string,
    applicationId: string,
    body: z.infer<typeof ReviewDeactivationRequestSchema>,
    key: string,
  ) =>
    authenticatedWriteFor(
      accountId,
      (header) =>
        reviewDeactivationRequest({
          ...sessionRequestOptions,
          headers: expected(accountId),
          body,
          params: {
            path: { id, requestId: applicationId },
            header: { ...header, 'Idempotency-Key': key },
          },
          signal: AbortSignal.timeout(10000),
        }),
      AdminUserResponseSchema,
      messages,
    ).catch(failed),
  list: (accountId: string, query: AdminUsersQuery, signal: AbortSignal) =>
    getAdminUsers({
      ...sessionRequestOptions,
      headers: expected(accountId),
      params: { query },
      signal: timeout(signal),
    })
      .then((response) => checkedResponse(response, AdminUsersResponseSchema))
      .catch(failed),
  detail: (accountId: string, id: string, signal: AbortSignal) =>
    getAdminUser({
      ...sessionRequestOptions,
      headers: expected(accountId),
      params: { path: { id } },
      signal: timeout(signal),
    })
      .then((response) => checkedResponse(response, AdminUserResponseSchema))
      .catch(failed),
  role: (
    accountId: string,
    id: string,
    body: z.infer<typeof SetAdminUserRoleSchema>,
    key: string,
  ) =>
    authenticatedWriteFor(
      accountId,
      (header) =>
        setAdminUserRole({
          ...sessionRequestOptions,
          headers: expected(accountId),
          body,
          params: { path: { id }, header: { ...header, 'Idempotency-Key': key } },
          signal: AbortSignal.timeout(10000),
        }),
      AdminUserResponseSchema,
      messages,
    ).catch(failed),
  status: (
    accountId: string,
    id: string,
    body: z.infer<typeof SetAdminUserStatusSchema>,
    key: string,
  ) =>
    authenticatedWriteFor(
      accountId,
      (header) =>
        setAdminUserStatus({
          ...sessionRequestOptions,
          headers: expected(accountId),
          body,
          params: { path: { id }, header: { ...header, 'Idempotency-Key': key } },
          signal: AbortSignal.timeout(10000),
        }),
      AdminUserResponseSchema,
      messages,
    ).catch(failed),
  sessions: (
    accountId: string,
    id: string,
    body: z.infer<typeof RevokeAdminUserSessionsSchema>,
    key: string,
  ) =>
    authenticatedWriteFor(
      accountId,
      (header) =>
        revokeAdminUserSessions({
          ...sessionRequestOptions,
          headers: expected(accountId),
          body,
          params: { path: { id }, header: { ...header, 'Idempotency-Key': key } },
          signal: AbortSignal.timeout(10000),
        }),
      AdminUserResponseSchema,
      messages,
    ).catch(failed),
};
