import {
  createReport,
  listOwnReports,
  getOwnReport,
  getOwnReportRecords,
  listAdminReports,
  getAdminReport,
  getAdminReportRecords,
  processReport,
} from '@personamarket/api-client';
import {
  OwnReportsResponseSchema,
  OwnReportResponseSchema,
  OwnReportRecordsResponseSchema,
  AdminReportsResponseSchema,
  AdminReportResponseSchema,
  AdminReportRecordsResponseSchema,
  reportEtag,
  type CreateReport,
  type OwnReportsQuery,
  type AdminReportsQuery,
  type AdminReportAction,
} from '@personamarket/contracts';
import {
  ApiError,
  authenticatedWriteFor,
  checkedResponse,
  sessionRequestOptions,
} from './auth-api';
import { requestAuthSessionRefresh } from './auth-session-events';
import { reportActionRequest } from './report-action-form';

export const reportsKey = (accountId: string, admin = false) =>
  ['private', admin ? 'report-management' : 'reports', accountId] as const;
const expected = (accountId: string) => ({ 'X-Expected-Account': accountId });
const timeout = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(10000)]);
const messages = {
  accountChanged: '登录账号已变化，请重新核对举报操作',
  verificationRequired: '请先完成登录验证，再继续举报操作',
};
function failed(cause: unknown): never {
  if (cause instanceof ApiError) {
    if (['UNAUTHENTICATED', 'FORBIDDEN'].includes(cause.code)) requestAuthSessionRefresh();
    throw cause;
  }
  throw new Error('举报服务暂时不可用，当前输入已保留，请核对结果后重试', { cause });
}
export const reportsApi = {
  create: (accountId: string, body: CreateReport, key: string) =>
    authenticatedWriteFor(
      accountId,
      (csrf) => {
        // OpenAPI 的可选字段不接受显式 undefined
        const target =
          body.target.type === 'persona'
            ? {
                type: body.target.type,
                personaId: body.target.personaId,
                ...(body.target.releaseId ? { releaseId: body.target.releaseId } : {}),
              }
            : body.target;
        return createReport({
          ...sessionRequestOptions,
          signal: AbortSignal.timeout(10000),
          headers: expected(accountId),
          body: { ...body, target },
          params: { header: { ...csrf, 'Idempotency-Key': key } },
        });
      },
      OwnReportResponseSchema,
      messages,
    ).catch(failed),
  ownList: (accountId: string, query: OwnReportsQuery, signal: AbortSignal) =>
    listOwnReports({
      ...sessionRequestOptions,
      signal: timeout(signal),
      headers: expected(accountId),
      params: { query },
    })
      .then((r) => checkedResponse(r, OwnReportsResponseSchema))
      .catch(failed),
  adminList: (accountId: string, input: AdminReportsQuery, signal: AbortSignal) => {
    const { id, ...query } = input;
    return listAdminReports({
      ...sessionRequestOptions,
      signal: timeout(signal),
      headers: expected(accountId),
      params: { query: { ...query, ...(id ? { id } : {}) } },
    })
      .then((r) => checkedResponse(r, AdminReportsResponseSchema))
      .catch(failed);
  },
  own: (accountId: string, id: string, signal: AbortSignal) =>
    getOwnReport({
      ...sessionRequestOptions,
      signal: timeout(signal),
      headers: expected(accountId),
      params: { path: { id } },
    })
      .then((r) => checkedResponse(r, OwnReportResponseSchema))
      .catch(failed),
  admin: (accountId: string, id: string, signal: AbortSignal) =>
    getAdminReport({
      ...sessionRequestOptions,
      signal: timeout(signal),
      headers: expected(accountId),
      params: { path: { id } },
    })
      .then((r) => checkedResponse(r, AdminReportResponseSchema))
      .catch(failed),
  ownRecords: (accountId: string, id: string, page: number, signal: AbortSignal) =>
    getOwnReportRecords({
      ...sessionRequestOptions,
      signal: timeout(signal),
      headers: expected(accountId),
      params: { path: { id }, query: { page, pageSize: 20 } },
    })
      .then((r) => checkedResponse(r, OwnReportRecordsResponseSchema))
      .catch(failed),
  adminRecords: (accountId: string, id: string, page: number, signal: AbortSignal) =>
    getAdminReportRecords({
      ...sessionRequestOptions,
      signal: timeout(signal),
      headers: expected(accountId),
      params: { path: { id }, query: { page, pageSize: 20 } },
    })
      .then((r) => checkedResponse(r, AdminReportRecordsResponseSchema))
      .catch(failed),
  act: (accountId: string, id: string, revision: number, body: AdminReportAction, key: string) =>
    authenticatedWriteFor(
      accountId,
      (csrf) =>
        processReport({
          ...sessionRequestOptions,
          signal: AbortSignal.timeout(10000),
          headers: expected(accountId),
          body: reportActionRequest(body),
          params: {
            path: { id },
            header: { ...csrf, 'If-Match': reportEtag(id, revision), 'Idempotency-Key': key },
          },
        }),
      AdminReportResponseSchema,
      messages,
    ).catch(failed),
};
