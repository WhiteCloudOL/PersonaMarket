import * as api from '@personamarket/api-client';
import {
  OwnProfileResponseSchema,
  ProfileHistoryResponseSchema,
  ProfileRecordsResponseSchema,
  ProfileSubmissionResponseSchema,
  ModerationProfilesResponseSchema,
  ModerationProfileResponseSchema,
  ProfileVisibilityResponseSchema,
  AssetResponseSchema,
  type SaveProfile,
  type SubmitProfile,
  type WithdrawProfile,
  type ReviewProfile,
  type SetProfileVisibility,
  type ProfileModerationQuery,
} from '@personamarket/contracts';
import {
  ApiError,
  authenticatedWriteFor,
  checkedResponse,
  sessionRequestOptions,
} from './auth-api';
import { requestAuthSessionRefresh } from './auth-session-events';

export const profilesKey = (accountId: string, admin = false) =>
  ['private', admin ? 'profile-management' : 'profile', accountId] as const;
const options = (accountId: string, signal?: AbortSignal) => ({
  ...sessionRequestOptions,
  signal: signal
    ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
    : AbortSignal.timeout(15000),
  headers: { 'X-Expected-Account': accountId },
});
const messages = {
  accountChanged: '登录账号已变化，请保留资料输入并重新核对',
  verificationRequired: '请完成登录验证后继续维护资料',
};
function failed(cause: unknown): never {
  if (cause instanceof ApiError) {
    if (['UNAUTHENTICATED', 'FORBIDDEN'].includes(cause.code)) requestAuthSessionRefresh();
    throw cause;
  }
  throw new Error('资料服务暂时不可用，输入已保留，请核对结果后重试', { cause });
}
export const profilesApi = {
  own: (accountId: string, signal?: AbortSignal) =>
    api
      .getOwnProfile(options(accountId, signal))
      .then((result) => checkedResponse(result, OwnProfileResponseSchema))
      .catch(failed),
  save: (accountId: string, body: SaveProfile) =>
    authenticatedWriteFor(
      accountId,
      (header) => api.saveOwnProfile({ ...options(accountId), body, params: { header } }),
      OwnProfileResponseSchema,
      messages,
    ).catch(failed),
  submit: (accountId: string, body: SubmitProfile, key: string) =>
    authenticatedWriteFor(
      accountId,
      (header) =>
        api.submitOwnProfile({
          ...options(accountId),
          body,
          params: { header: { ...header, 'Idempotency-Key': key } },
        }),
      ProfileSubmissionResponseSchema,
      messages,
    ).catch(failed),
  withdraw: (accountId: string, id: string, body: WithdrawProfile, key: string) =>
    authenticatedWriteFor(
      accountId,
      (header) =>
        api.withdrawOwnProfileSubmission({
          ...options(accountId),
          body,
          params: { path: { id }, header: { ...header, 'Idempotency-Key': key } },
        }),
      ProfileSubmissionResponseSchema,
      messages,
    ).catch(failed),
  history: (accountId: string, page: number, signal: AbortSignal) =>
    api
      .listOwnProfileSubmissions({
        ...options(accountId, signal),
        params: { query: { page, pageSize: 20 } },
      })
      .then((result) => checkedResponse(result, ProfileHistoryResponseSchema))
      .catch(failed),
  submission: (accountId: string, id: string, signal: AbortSignal) =>
    api
      .getOwnProfileSubmission({ ...options(accountId, signal), params: { path: { id } } })
      .then((result) => checkedResponse(result, ProfileSubmissionResponseSchema))
      .catch(failed),
  records: (accountId: string, page: number, signal: AbortSignal, userId?: string) =>
    (userId
      ? api.listModerationProfileRecords({
          ...options(accountId, signal),
          params: { path: { userId }, query: { page, pageSize: 20 } },
        })
      : api.listOwnProfileRecords({
          ...options(accountId, signal),
          params: { query: { page, pageSize: 20 } },
        })
    )
      .then((result) => checkedResponse(result, ProfileRecordsResponseSchema))
      .catch(failed),
  moderationList: (accountId: string, query: ProfileModerationQuery, signal: AbortSignal) =>
    api
      .listProfileModeration({ ...options(accountId, signal), params: { query } })
      .then((result) => checkedResponse(result, ModerationProfilesResponseSchema))
      .catch(failed),
  moderation: (accountId: string, id: string, signal?: AbortSignal) =>
    api
      .getProfileModeration({ ...options(accountId, signal), params: { path: { id } } })
      .then((result) => checkedResponse(result, ModerationProfileResponseSchema))
      .catch(failed),
  review: (accountId: string, id: string, body: ReviewProfile, key: string) =>
    authenticatedWriteFor(
      accountId,
      (header) =>
        api.reviewProfileSubmission({
          ...options(accountId),
          body,
          params: { path: { id }, header: { ...header, 'Idempotency-Key': key } },
        }),
      ModerationProfileResponseSchema,
      messages,
    ).catch(failed),
  visibility: (accountId: string, userId: string, body: SetProfileVisibility, key: string) =>
    authenticatedWriteFor(
      accountId,
      (header) =>
        api.setProfileVisibility({
          ...options(accountId),
          body,
          params: { path: { userId }, header: { ...header, 'Idempotency-Key': key } },
        }),
      ProfileVisibilityResponseSchema,
      messages,
    ).catch(failed),
  avatar: (accountId: string, file: File) =>
    authenticatedWriteFor(
      accountId,
      (header) =>
        api.uploadOwnImage({
          ...options(accountId),
          body: { file },
          params: { path: { purpose: 'avatar' }, header },
          bodySerializer: (body) => {
            const form = new FormData();
            form.set('file', body.file);
            return form;
          },
        }),
      AssetResponseSchema,
      messages,
    ).catch(failed),
};
