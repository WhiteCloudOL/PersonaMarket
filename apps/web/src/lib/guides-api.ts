import {
  listAdminGuides,
  getAdminGuide,
  updateAdminGuide,
  changeAdminGuideState,
  getGuideRecords,
} from '@personamarket/api-client';
import {
  AdminGuidesResponseSchema,
  AdminGuideResponseSchema,
  GuideRecordsResponseSchema,
  guideEtag,
  type GuideSlug,
  type GuideWrite,
  type GuideAction,
  type GuideActionName,
  type AdminGuidesQuery,
  type GuideRecordsQuery,
} from '@personamarket/contracts';
import {
  ApiError,
  authenticatedWriteFor,
  checkedResponse,
  sessionRequestOptions,
} from './auth-api';
import { requestAuthSessionRefresh } from './auth-session-events';

export const guidesKey = (accountId: string) => ['private', 'guide-management', accountId] as const;
const headers = (accountId: string) => ({ 'X-Expected-Account': accountId });
const timeout = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(10000)]);
function failed(cause: unknown): never {
  if (cause instanceof ApiError) {
    if (['UNAUTHENTICATED', 'FORBIDDEN'].includes(cause.code)) requestAuthSessionRefresh();
    throw cause;
  }
  throw new Error('指南暂时无法读取或保存，请核对状态后重试', { cause });
}
export type GuideCommand =
  | { action: 'edit'; slug: GuideSlug; revision: number; input: GuideWrite }
  | { action: GuideActionName; slug: GuideSlug; revision: number; input: GuideAction };
export const guidesApi = {
  list: (accountId: string, input: AdminGuidesQuery, signal: AbortSignal) =>
    listAdminGuides({
      ...sessionRequestOptions,
      headers: headers(accountId),
      signal: timeout(signal),
      params: { query: input },
    })
      .then((result) => checkedResponse(result, AdminGuidesResponseSchema))
      .catch(failed),
  read: (accountId: string, slug: GuideSlug, signal: AbortSignal) =>
    getAdminGuide({
      ...sessionRequestOptions,
      headers: headers(accountId),
      signal: timeout(signal),
      params: { path: { slug } },
    })
      .then((result) => checkedResponse(result, AdminGuideResponseSchema))
      .catch(failed),
  records: (accountId: string, slug: GuideSlug, input: GuideRecordsQuery, signal: AbortSignal) =>
    getGuideRecords({
      ...sessionRequestOptions,
      headers: headers(accountId),
      signal: timeout(signal),
      params: { path: { slug }, query: input },
    })
      .then((result) => checkedResponse(result, GuideRecordsResponseSchema))
      .catch(failed),
  mutate: (accountId: string, command: GuideCommand, key: string) =>
    authenticatedWriteFor(
      accountId,
      (csrf) => {
        const common = {
          ...sessionRequestOptions,
          headers: headers(accountId),
          signal: AbortSignal.timeout(10000),
        };
        const header = {
          ...csrf,
          'If-Match': guideEtag(command.slug, command.revision),
          'Idempotency-Key': key,
        };
        return command.action === 'edit'
          ? updateAdminGuide({
              ...common,
              body: command.input,
              params: { path: { slug: command.slug }, header },
            })
          : changeAdminGuideState({
              ...common,
              body: command.input,
              params: { path: { slug: command.slug, action: command.action }, header },
            });
      },
      AdminGuideResponseSchema,
      {
        accountChanged: '登录账号已变化，请重新确认指南内容',
        verificationRequired: '请先完成登录验证，再维护指南',
      },
    ).catch(failed),
};
