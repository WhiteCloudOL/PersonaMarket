import * as api from '@personamarket/api-client';
import {
  NotificationsResponseSchema,
  NotificationCountResponseSchema,
  NotificationReadResponseSchema,
  NotificationRecipientResponseSchema,
  AdminNoticesResponseSchema,
  AdminNoticeResponseSchema,
  type NotificationsQuery,
  type AdminNoticesQuery,
  type CreateAdminNotice,
  NotificationFailuresResponseSchema,
  NotificationFailureResponseSchema,
  type NotificationFailuresQuery,
  NotificationPreferencesResponseSchema,
  type UpdateNotificationPreferences,
  NotificationDeliveryDetailResponseSchema,
  NotificationRetryReceiptResponseSchema,
} from '@personamarket/contracts';
import {
  ApiError,
  authenticatedWriteFor,
  checkedResponse,
  sessionRequestOptions,
} from './auth-api';
import { requestAuthSessionRefresh } from './auth-session-events';

export const notificationsKey = (accountId: string) =>
  ['private', 'notifications', accountId] as const;
const expected = (accountId: string) => ({ 'X-Expected-Account': accountId });
const signalFor = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(10000)]);
const messages = {
  accountChanged: '登录账号已变化，请重新核对通知操作',
  verificationRequired: '请先完成登录验证，再继续通知操作',
};
function failed(cause: unknown): never {
  if (cause instanceof ApiError) {
    if (['UNAUTHENTICATED', 'FORBIDDEN'].includes(cause.code)) requestAuthSessionRefresh();
    throw cause;
  }
  throw new Error('通知服务暂时不可用，请核对结果后重试，当前输入已保留', { cause });
}
export const notificationsApi = {
  noticeContent: (accountId: string, id: string, signal: AbortSignal) =>
    api
      .getAdminNotice({
        ...sessionRequestOptions,
        signal: signalFor(signal),
        headers: expected(accountId),
        params: { path: { id } },
      })
      .then((r) => checkedResponse(r, AdminNoticeResponseSchema))
      .catch(failed),
  delivery: (accountId: string, id: string, signal: AbortSignal) =>
    api
      .getNotificationDelivery({
        ...sessionRequestOptions,
        signal: signalFor(signal),
        headers: expected(accountId),
        params: { path: { id } },
      })
      .then((r) => checkedResponse(r, NotificationDeliveryDetailResponseSchema))
      .catch(failed),
  retryReceipt: (
    accountId: string,
    id: string,
    expectedRevision: number,
    key: string,
    signal: AbortSignal,
  ) =>
    api
      .getNotificationRetryReceipt({
        ...sessionRequestOptions,
        signal: signalFor(signal),
        headers: expected(accountId),
        params: {
          path: { id },
          query: { expectedRevision },
          header: { 'Idempotency-Key': key },
        },
      })
      .then((r) => checkedResponse(r, NotificationRetryReceiptResponseSchema))
      .catch(failed),
  preferences: (accountId: string, signal: AbortSignal) =>
    api
      .getNotificationPreferences({
        ...sessionRequestOptions,
        signal: signalFor(signal),
        headers: expected(accountId),
      })
      .then((r) => checkedResponse(r, NotificationPreferencesResponseSchema))
      .catch(failed),
  updatePreferences: (accountId: string, body: UpdateNotificationPreferences) =>
    authenticatedWriteFor(
      accountId,
      (csrf) =>
        api.updateNotificationPreferences({
          ...sessionRequestOptions,
          signal: AbortSignal.timeout(10000),
          headers: expected(accountId),
          params: { header: csrf },
          body,
        }),
      NotificationPreferencesResponseSchema,
      messages,
    ).catch(failed),
  failures: (accountId: string, query: NotificationFailuresQuery, signal: AbortSignal) =>
    api
      .listNotificationFailures({
        ...sessionRequestOptions,
        signal: signalFor(signal),
        headers: expected(accountId),
        params: { query },
      })
      .then((r) => checkedResponse(r, NotificationFailuresResponseSchema))
      .catch(failed),
  retryFailure: (accountId: string, id: string, revision: number, key: string) =>
    authenticatedWriteFor(
      accountId,
      (csrf) =>
        api.retryNotificationFailure({
          ...sessionRequestOptions,
          signal: AbortSignal.timeout(10000),
          headers: expected(accountId),
          params: { path: { id }, header: { ...csrf, 'Idempotency-Key': key } },
          body: { expectedRevision: revision, confirmed: true },
        }),
      NotificationFailureResponseSchema,
      messages,
    ).catch(failed),
  list: (accountId: string, query: NotificationsQuery, signal: AbortSignal) =>
    api
      .listNotifications({
        ...sessionRequestOptions,
        signal: signalFor(signal),
        headers: expected(accountId),
        params: { query },
      })
      .then((r) => checkedResponse(r, NotificationsResponseSchema))
      .catch(failed),
  count: (accountId: string, signal: AbortSignal) =>
    api
      .getNotificationCount({
        ...sessionRequestOptions,
        signal: signalFor(signal),
        headers: expected(accountId),
      })
      .then((r) => checkedResponse(r, NotificationCountResponseSchema))
      .catch(failed),
  read: (accountId: string, id: string) =>
    authenticatedWriteFor(
      accountId,
      (csrf) =>
        api.readNotification({
          ...sessionRequestOptions,
          signal: AbortSignal.timeout(10000),
          headers: expected(accountId),
          params: { path: { id }, header: csrf },
          body: {},
        }),
      NotificationReadResponseSchema,
      messages,
    ).catch(failed),
  readAll: (accountId: string, throughId: string) =>
    authenticatedWriteFor(
      accountId,
      (csrf) =>
        api.readAllNotifications({
          ...sessionRequestOptions,
          signal: AbortSignal.timeout(10000),
          headers: expected(accountId),
          params: { header: csrf },
          body: { throughId },
        }),
      NotificationReadResponseSchema,
      messages,
    ).catch(failed),
  recipient: (accountId: string, username: string) =>
    api
      .findNotificationRecipient({
        ...sessionRequestOptions,
        signal: AbortSignal.timeout(10000),
        headers: expected(accountId),
        params: { query: { username } },
      })
      .then((r) => checkedResponse(r, NotificationRecipientResponseSchema))
      .catch(failed),
  history: (accountId: string, input: AdminNoticesQuery, signal: AbortSignal) => {
    const { recipientId, ...query } = input;
    return api
      .listAdminNotices({
        ...sessionRequestOptions,
        signal: signalFor(signal),
        headers: expected(accountId),
        params: { query: { ...query, ...(recipientId ? { recipientId } : {}) } },
      })
      .then((r) => checkedResponse(r, AdminNoticesResponseSchema))
      .catch(failed);
  },
  create: (accountId: string, body: CreateAdminNotice, key: string) =>
    authenticatedWriteFor(
      accountId,
      (csrf) =>
        api.createAdminNotice({
          ...sessionRequestOptions,
          signal: AbortSignal.timeout(10000),
          headers: expected(accountId),
          params: { header: { ...csrf, 'Idempotency-Key': key } },
          body,
        }),
      AdminNoticeResponseSchema,
      messages,
    ).catch(failed),
  retry: (accountId: string, id: string, revision: number, key: string) =>
    authenticatedWriteFor(
      accountId,
      (csrf) =>
        api.retryAdminNotice({
          ...sessionRequestOptions,
          signal: AbortSignal.timeout(10000),
          headers: expected(accountId),
          params: { path: { id }, header: { ...csrf, 'Idempotency-Key': key } },
          body: { expectedRevision: revision, confirmed: true },
        }),
      AdminNoticeResponseSchema,
      messages,
    ).catch(failed),
};
