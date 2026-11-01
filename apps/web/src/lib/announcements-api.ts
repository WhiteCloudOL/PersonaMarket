import {
  listAdminAnnouncements,
  getAdminAnnouncement,
  getAdminAnnouncementRecords,
  createAdminAnnouncement,
  updateAdminAnnouncement,
  changeAdminAnnouncementState,
} from '@personamarket/api-client';
import {
  AdminAnnouncementsResponseSchema,
  AdminAnnouncementResponseSchema,
  AnnouncementRecordsResponseSchema,
  announcementEtag,
  type AdminAnnouncementsQuery,
  type AnnouncementRecordsQuery,
  type AnnouncementWrite,
  type AnnouncementAction,
  type AnnouncementActionName,
} from '@personamarket/contracts';
import {
  ApiError,
  authenticatedWriteFor,
  checkedResponse,
  sessionRequestOptions,
} from './auth-api';
import { requestAuthSessionRefresh } from './auth-session-events';

export const announcementsKey = (accountId: string) =>
  ['private', 'announcement-management', accountId] as const;
const headers = (accountId: string) => ({ 'X-Expected-Account': accountId });
const timeout = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(10000)]);
function failed(cause: unknown): never {
  if (cause instanceof ApiError) {
    if (['UNAUTHENTICATED', 'FORBIDDEN'].includes(cause.code)) requestAuthSessionRefresh();
    throw cause;
  }
  throw new Error('公告服务暂时不可用，请核对状态后重试', { cause });
}
export type AnnouncementCommand =
  | { action: 'create'; body: AnnouncementWrite }
  | { action: 'edit'; id: string; revision: number; body: AnnouncementWrite }
  | { action: AnnouncementActionName; id: string; revision: number; body: AnnouncementAction };
export const announcementsApi = {
  list: (accountId: string, input: AdminAnnouncementsQuery, signal: AbortSignal) =>
    listAdminAnnouncements({
      ...sessionRequestOptions,
      headers: headers(accountId),
      params: { query: input },
      signal: timeout(signal),
    })
      .then((response) => checkedResponse(response, AdminAnnouncementsResponseSchema))
      .catch(failed),
  detail: (accountId: string, id: string, signal: AbortSignal) =>
    getAdminAnnouncement({
      ...sessionRequestOptions,
      headers: headers(accountId),
      params: { path: { id } },
      signal: timeout(signal),
    })
      .then((response) => checkedResponse(response, AdminAnnouncementResponseSchema))
      .catch(failed),
  records: (accountId: string, id: string, input: AnnouncementRecordsQuery, signal: AbortSignal) =>
    getAdminAnnouncementRecords({
      ...sessionRequestOptions,
      headers: headers(accountId),
      params: { path: { id }, query: input },
      signal: timeout(signal),
    })
      .then((response) => checkedResponse(response, AnnouncementRecordsResponseSchema))
      .catch(failed),
  write: (accountId: string, command: AnnouncementCommand, key: string) =>
    authenticatedWriteFor(
      accountId,
      (csrf) => {
        const base = {
          ...sessionRequestOptions,
          headers: headers(accountId),
          signal: AbortSignal.timeout(10000),
        };
        const operationHeaders = { ...csrf, 'Idempotency-Key': key };
        if (command.action === 'create')
          return createAdminAnnouncement({
            ...base,
            body: command.body,
            params: { header: operationHeaders },
          });
        const header = {
          ...operationHeaders,
          'If-Match': announcementEtag(command.id, command.revision),
        };
        if (command.action === 'edit')
          return updateAdminAnnouncement({
            ...base,
            body: command.body,
            params: { path: { id: command.id }, header },
          });
        return changeAdminAnnouncementState({
          ...base,
          body: command.body,
          params: { path: { id: command.id, action: command.action }, header },
        });
      },
      AdminAnnouncementResponseSchema,
      {
        accountChanged: '登录账号已变化，请重新确认公告操作',
        verificationRequired: '请先完成登录验证，再继续公告管理',
      },
    ).catch(failed),
};
