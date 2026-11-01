import * as api from '@personamarket/api-client';
import {
  SubmissionResponseSchema,
  SubmissionListResponseSchema,
  ReviewDetailResponseSchema,
  PublicReleaseResponseSchema,
  PublicReleaseListResponseSchema,
  PublicPersonaListResponseSchema,
  AuthNoticeResponseSchema,
  ExportPreviewResponseSchema,
  type ExportFormat,
  type CreateReleaseSchema,
  type ReviewRequestSchema,
  type PersonaModerationSchema,
  AdminPersonaResponseSchema,
} from '@personamarket/contracts';
import { z } from 'zod';
import {
  ApiError,
  authenticatedWrite,
  authenticatedWriteFor,
  checkedResponse,
  sessionRequestOptions,
} from './auth-api';
const options = (timeout = 15000) => ({
  ...sessionRequestOptions,
  signal: AbortSignal.timeout(timeout),
});
export const releasesApi = {
  download: async (id: string, releaseId: string, format: ExportFormat, signal?: AbortSignal) => {
    try {
      // ZIP最多128MiB，采用独立传输时限；普通API仍保持15秒
      const request = options(format === 'market-zip' ? 300000 : 15000);
      const result = await api.downloadPublicExport({
        ...request,
        signal: signal ? AbortSignal.any([request.signal, signal]) : request.signal,
        parseAs: 'blob',
        params: { path: { id, releaseId }, query: { format } },
      });
      return checkedResponse(result, z.instanceof(Blob));
    } catch (cause) {
      if (cause instanceof ApiError) throw cause;
      throw new Error('下载失败，请检查网络后重试', { cause });
    }
  },
  exportPreview: async (id: string, releaseId: string, format: ExportFormat) =>
    checkedResponse(
      await api.previewPublicExport({
        ...options(),
        params: { path: { id, releaseId }, query: { format } },
      }),
      ExportPreviewResponseSchema,
    ),
  create: (id: string, body: z.infer<typeof CreateReleaseSchema>, key: string) =>
    authenticatedWrite(
      (header) =>
        api.createOwnRelease({
          ...options(),
          body,
          params: { path: { id }, header: { ...header, 'Idempotency-Key': key } },
        }),
      SubmissionResponseSchema,
    ),
  own: async (id: string, page = 1) =>
    checkedResponse(
      await api.getOwnSubmissions({ ...options(), params: { path: { id }, query: { page } } }),
      SubmissionListResponseSchema,
    ),
  withdraw: (id: string, expectedRevision: number, reason: string) =>
    authenticatedWrite(
      (header) =>
        api.withdrawOwnSubmission({
          ...options(),
          body: { expectedRevision, reason },
          params: { path: { id }, header },
        }),
      SubmissionResponseSchema,
    ),
  restore: (id: string, submissionId: string, expectedDraftRevision: number) =>
    authenticatedWrite(
      (header) =>
        api.restoreOwnSubmissionDraft({
          ...options(),
          body: { submissionId, expectedDraftRevision, confirmed: true },
          params: { path: { id }, header },
        }),
      AuthNoticeResponseSchema,
    ),
  queue: async (status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN', page = 1) =>
    checkedResponse(
      await api.getSubmissionReviewQueue({ ...options(), params: { query: { status, page } } }),
      SubmissionListResponseSchema,
    ),
  detail: async (id: string) =>
    checkedResponse(
      await api.getSubmissionReviewDetail({ ...options(), params: { path: { id } } }),
      ReviewDetailResponseSchema,
    ),
  review: (id: string, body: z.infer<typeof ReviewRequestSchema>, key: string) =>
    authenticatedWrite(
      (header) =>
        api.reviewSubmission({
          ...options(),
          body,
          params: { path: { id }, header: { ...header, 'Idempotency-Key': key } },
        }),
      SubmissionResponseSchema,
    ),
  current: async (id: string) =>
    checkedResponse(
      await api.getPublicPersona({ ...options(), params: { path: { id } } }),
      PublicReleaseResponseSchema,
    ),
  history: async (id: string, page = 1) =>
    checkedResponse(
      await api.getPublicReleaseHistory({
        ...options(),
        params: { path: { id }, query: { page } },
      }),
      PublicReleaseListResponseSchema,
    ),
  release: async (id: string, releaseId: string) =>
    checkedResponse(
      await api.getPublicRelease({ ...options(), params: { path: { id, releaseId } } }),
      PublicReleaseResponseSchema,
    ),
  list: async (page = 1) =>
    checkedResponse(
      await api.listPublicPersonas({ ...options(), params: { query: { page, pageSize: 12 } } }),
      PublicPersonaListResponseSchema,
    ),
  visibility: (id: string, visibility: 'listed' | 'hidden', reason: string) =>
    authenticatedWrite(
      (header) =>
        api.setOwnPersonaVisibility({
          ...options(),
          body: { visibility, reason },
          params: { path: { id }, header },
        }),
      AuthNoticeResponseSchema,
    ),
  rollback: (id: string, releaseId: string, reason: string) =>
    authenticatedWrite(
      (header) =>
        api.selectOwnPublicRelease({
          ...options(),
          body: { releaseId, reason },
          params: { path: { id }, header },
        }),
      AuthNoticeResponseSchema,
    ),
  moderationContext: (id: string, accountId: string, signal: AbortSignal) =>
    api
      .getAdminPersona({
        ...sessionRequestOptions,
        headers: { 'X-Expected-Account': accountId },
        params: { path: { id } },
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      })
      .then((result) => checkedResponse(result, AdminPersonaResponseSchema)),
  moderate: (
    id: string,
    body: z.infer<typeof PersonaModerationSchema>,
    key: string,
    accountId: string,
  ) =>
    authenticatedWriteFor(
      accountId,
      (header) =>
        api.moderatePersona({
          ...options(),
          body,
          params: {
            path: { id },
            header: { ...header, 'Idempotency-Key': key, 'X-Expected-Account': accountId },
          },
        }),
      AuthNoticeResponseSchema,
      {
        accountChanged: '登录账号已变化，请重新确认处置',
        verificationRequired: '请先完成登录验证，再继续处置',
      },
    ),
  state: (
    id: string,
    releaseId: string,
    action: 'withdraw' | 'block' | 'restore',
    reason: string,
  ) =>
    authenticatedWrite(
      (header) =>
        api.changeReleaseState({
          ...options(),
          body: { action, reason },
          params: { path: { id, releaseId }, header },
        }),
      AuthNoticeResponseSchema,
    ),
};
