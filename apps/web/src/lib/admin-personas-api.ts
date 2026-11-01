import {
  getAdminPersonas,
  getAdminPersona,
  getAdminPersonaRecords,
  setPersonaCuration,
  moderatePersona,
  bulkManagePersonas,
} from '@personamarket/api-client';
import {
  AdminPersonasResponseSchema,
  AdminPersonaResponseSchema,
  AdminPersonaRecordsResponseSchema,
  AdminPersonaBulkResponseSchema,
  AuthNoticeResponseSchema,
  type AdminPersonasQuery,
  type AdminPersonaRecordsQuery,
  type SetPersonaCuration,
  type AdminPersonaBulkRequest,
  type AdminPersonaSummarySchema,
  type PersonaModerationSchema,
} from '@personamarket/contracts';
import type { z } from 'zod';
import {
  ApiError,
  authenticatedWriteFor,
  checkedResponse,
  sessionRequestOptions,
} from './auth-api';
import { requestAuthSessionRefresh } from './auth-session-events';

export type AdminPersona = z.infer<typeof AdminPersonaSummarySchema>;
export const adminPersonasKey = (accountId: string) =>
  ['private', 'admin-personas', accountId] as const;
const expected = (accountId: string) => ({ 'X-Expected-Account': accountId });
function listInput(input: AdminPersonasQuery) {
  const { ownerId, categoryId, ...query } = input;
  return { ...query, ...(ownerId ? { ownerId } : {}), ...(categoryId ? { categoryId } : {}) };
}
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
  throw new Error('人设管理服务暂时不可用，请核对状态后重试', { cause });
}
export const adminPersonasApi = {
  list: (accountId: string, input: AdminPersonasQuery, signal: AbortSignal) =>
    getAdminPersonas({
      ...sessionRequestOptions,
      headers: expected(accountId),
      params: { query: listInput(input) },
      signal: timeout(signal),
    })
      .then((result) => checkedResponse(result, AdminPersonasResponseSchema))
      .catch(failed),
  detail: (accountId: string, id: string, signal: AbortSignal) =>
    getAdminPersona({
      ...sessionRequestOptions,
      headers: expected(accountId),
      params: { path: { id } },
      signal: timeout(signal),
    })
      .then((result) => checkedResponse(result, AdminPersonaResponseSchema))
      .catch(failed),
  records: (accountId: string, id: string, input: AdminPersonaRecordsQuery, signal: AbortSignal) =>
    getAdminPersonaRecords({
      ...sessionRequestOptions,
      headers: expected(accountId),
      params: { path: { id }, query: input },
      signal: timeout(signal),
    })
      .then((result) => checkedResponse(result, AdminPersonaRecordsResponseSchema))
      .catch(failed),
  curate: (accountId: string, id: string, body: SetPersonaCuration, key: string) =>
    authenticatedWriteFor(
      accountId,
      (header) =>
        setPersonaCuration({
          ...sessionRequestOptions,
          headers: expected(accountId),
          body,
          params: { path: { id }, header: { ...header, 'Idempotency-Key': key } },
          signal: AbortSignal.timeout(10000),
        }),
      AuthNoticeResponseSchema,
      messages,
    ).catch(failed),
  moderate: (
    accountId: string,
    id: string,
    body: z.infer<typeof PersonaModerationSchema>,
    key: string,
  ) =>
    authenticatedWriteFor(
      accountId,
      (header) =>
        moderatePersona({
          ...sessionRequestOptions,
          headers: expected(accountId),
          body,
          params: { path: { id }, header: { ...header, 'Idempotency-Key': key } },
          signal: AbortSignal.timeout(10000),
        }),
      AuthNoticeResponseSchema,
      messages,
    ).catch(failed),
  bulk: (accountId: string, body: AdminPersonaBulkRequest) =>
    authenticatedWriteFor(
      accountId,
      (header) =>
        bulkManagePersonas({
          ...sessionRequestOptions,
          headers: expected(accountId),
          body,
          params: { header },
          signal: AbortSignal.timeout(20000),
        }),
      AdminPersonaBulkResponseSchema,
      messages,
    ).catch(failed),
};
