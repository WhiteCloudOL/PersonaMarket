import {
  listAdminCategories,
  listAdminTags,
  getAdminCategory,
  getAdminTag,
  createAdminCategory,
  createAdminTag,
  updateAdminCategory,
  updateAdminTag,
  archiveAdminCategory,
  archiveAdminTag,
  restoreAdminCategory,
  restoreAdminTag,
  getAdminCategoryRecords,
  getAdminTagRecords,
} from '@personamarket/api-client';
import {
  TaxonomyManagementListResponseSchema,
  TaxonomyManagementDetailResponseSchema,
  TaxonomyManagementRecordsResponseSchema,
  taxonomyEntryEtag,
  type TaxonomyKind,
  type TaxonomyManagementQuery,
  type TaxonomyManagementPagination,
  type CreateTaxonomyEntry,
  type TaxonomyAction,
} from '@personamarket/contracts';
import {
  ApiError,
  authenticatedWriteFor,
  checkedResponse,
  sessionRequestOptions,
} from './auth-api';
import { requestAuthSessionRefresh } from './auth-session-events';

export const taxonomyManagementKey = (accountId: string, kind: TaxonomyKind) =>
  ['private', 'taxonomy-management', accountId, kind] as const;
const headers = (accountId: string) => ({ 'X-Expected-Account': accountId });
const timeout = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(10000)]);
const messages = {
  accountChanged: '登录账号已变化，请重新确认目录操作',
  verificationRequired: '请先完成登录验证，再继续目录管理',
};
function failed(cause: unknown): never {
  if (cause instanceof ApiError) {
    if (['UNAUTHENTICATED', 'FORBIDDEN'].includes(cause.code)) requestAuthSessionRefresh();
    throw cause;
  }
  throw new Error('目录管理服务暂时不可用，请核对状态后重试', { cause });
}
export type TaxonomyWrite =
  | { action: 'create'; body: CreateTaxonomyEntry }
  | { action: 'update'; id: string; revision: number; body: CreateTaxonomyEntry }
  | { action: 'archive' | 'restore'; id: string; revision: number; body: TaxonomyAction };
export const taxonomyManagementApi = {
  list: (
    accountId: string,
    kind: TaxonomyKind,
    input: TaxonomyManagementQuery,
    signal: AbortSignal,
  ) =>
    (kind === 'category' ? listAdminCategories : listAdminTags)({
      ...sessionRequestOptions,
      headers: headers(accountId),
      params: { query: input },
      signal: timeout(signal),
    })
      .then((response) => checkedResponse(response, TaxonomyManagementListResponseSchema))
      .catch(failed),
  detail: (accountId: string, kind: TaxonomyKind, id: string, signal: AbortSignal) =>
    (kind === 'category' ? getAdminCategory : getAdminTag)({
      ...sessionRequestOptions,
      headers: headers(accountId),
      params: { path: { id } },
      signal: timeout(signal),
    })
      .then((response) => checkedResponse(response, TaxonomyManagementDetailResponseSchema))
      .catch(failed),
  records: (
    accountId: string,
    kind: TaxonomyKind,
    id: string,
    input: TaxonomyManagementPagination,
    signal: AbortSignal,
  ) =>
    (kind === 'category' ? getAdminCategoryRecords : getAdminTagRecords)({
      ...sessionRequestOptions,
      headers: headers(accountId),
      params: { path: { id }, query: input },
      signal: timeout(signal),
    })
      .then((response) => checkedResponse(response, TaxonomyManagementRecordsResponseSchema))
      .catch(failed),
  write: (accountId: string, kind: TaxonomyKind, input: TaxonomyWrite, key: string) =>
    authenticatedWriteFor(
      accountId,
      (csrf) => {
        const base = {
          ...sessionRequestOptions,
          headers: headers(accountId),
          signal: AbortSignal.timeout(10000),
        };
        const operationHeaders = { ...csrf, 'Idempotency-Key': key };
        if (input.action === 'create')
          return (kind === 'category' ? createAdminCategory : createAdminTag)({
            ...base,
            body: input.body,
            params: { header: operationHeaders },
          });
        const params = {
          path: { id: input.id },
          header: {
            ...operationHeaders,
            'If-Match': taxonomyEntryEtag(kind, input.id, input.revision),
          },
        };
        if (input.action === 'update')
          return (kind === 'category' ? updateAdminCategory : updateAdminTag)({
            ...base,
            params,
            body: input.body,
          });
        if (input.action === 'archive')
          return (kind === 'category' ? archiveAdminCategory : archiveAdminTag)({
            ...base,
            params,
            body: input.body,
          });
        return (kind === 'category' ? restoreAdminCategory : restoreAdminTag)({
          ...base,
          params,
          body: input.body,
        });
      },
      TaxonomyManagementDetailResponseSchema,
      messages,
    ).catch(failed),
};
