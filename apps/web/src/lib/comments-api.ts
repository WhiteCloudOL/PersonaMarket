import {
  getPublicComments,
  getCommentReplies,
  getOwnComments,
  getOwnComment,
  createComment,
  editComment,
  deleteComment,
  getModerationComments,
  getModerationComment,
  reviewComment,
  reviewCommentsBatch,
  setCommentVisibility,
} from '@personamarket/api-client';
import {
  PublicCommentsResponseSchema,
  OwnCommentsResponseSchema,
  CommentResponseSchema,
  CommentActionResponseSchema,
  AdminCommentResponseSchema,
  CommentModerationResponseSchema,
  BulkReviewCommentsResponseSchema,
  type CommentsQuery,
  type CreateCommentSchema,
  type EditCommentSchema,
  type ReviewCommentSchema,
  type BulkReviewCommentsSchema,
  type CommentVisibilitySchema,
  type CommentModerationQuerySchema,
} from '@personamarket/contracts';
import type { z } from 'zod';
import {
  ApiError,
  authenticatedWriteFor,
  checkedResponse,
  sessionRequestOptions,
} from './auth-api';

export const commentsKey = (personaId: string) => ['public', 'comments', personaId] as const;
export const ownCommentsKey = (accountId: string, personaId: string) =>
  ['private', 'comments', accountId, personaId] as const;
export const moderationCommentsKey = (accountId: string) =>
  ['private', 'comment-moderation', accountId] as const;
const timeout = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(10000)]);
const expected = (accountId: string) => ({ 'X-Expected-Account': accountId });
const messages = {
  accountChanged: '登录账号已变化，请重新确认评论操作',
  verificationRequired: '请先完成登录验证，再继续评论操作',
};
function failed(cause: unknown): never {
  if (cause instanceof ApiError) throw cause;
  throw new Error('评论服务暂时不可用，请稍后重试', { cause });
}
export const commentsApi = {
  public: (id: string, query: CommentsQuery, signal: AbortSignal) =>
    getPublicComments({
      ...sessionRequestOptions,
      signal: timeout(signal),
      params: { path: { id }, query },
    })
      .then((result) => checkedResponse(result, PublicCommentsResponseSchema))
      .catch(failed),
  replies: (id: string, query: CommentsQuery, signal: AbortSignal) =>
    getCommentReplies({
      ...sessionRequestOptions,
      signal: timeout(signal),
      params: { path: { id }, query },
    })
      .then((result) => checkedResponse(result, PublicCommentsResponseSchema))
      .catch(failed),
  own: (accountId: string, personaId: string, page: number, signal: AbortSignal) =>
    getOwnComments({
      ...sessionRequestOptions,
      headers: expected(accountId),
      signal: timeout(signal),
      params: { query: { personaId, page, pageSize: 5, sort: 'newest' } },
    })
      .then((result) => checkedResponse(result, OwnCommentsResponseSchema))
      .catch(failed),
  ownDetail: (accountId: string, id: string, signal: AbortSignal) =>
    getOwnComment({
      ...sessionRequestOptions,
      headers: expected(accountId),
      signal: timeout(signal),
      params: { path: { id } },
    })
      .then((result) => checkedResponse(result, CommentResponseSchema))
      .catch(failed),
  create: (
    accountId: string,
    id: string,
    body: z.infer<typeof CreateCommentSchema>,
    key: string,
  ) => {
    const { parentId, replyToId, releaseId, ...content } = body;
    return authenticatedWriteFor(
      accountId,
      (header) =>
        createComment({
          ...sessionRequestOptions,
          headers: expected(accountId),
          signal: AbortSignal.timeout(10000),
          body: {
            ...content,
            ...(parentId === undefined ? {} : { parentId }),
            ...(replyToId === undefined ? {} : { replyToId }),
            ...(releaseId === undefined ? {} : { releaseId }),
          },
          params: { path: { id }, header: { ...header, 'Idempotency-Key': key } },
        }),
      CommentResponseSchema,
      messages,
    ).catch(failed);
  },
  edit: (accountId: string, id: string, body: z.infer<typeof EditCommentSchema>, key: string) =>
    authenticatedWriteFor(
      accountId,
      (header) =>
        editComment({
          ...sessionRequestOptions,
          headers: expected(accountId),
          signal: AbortSignal.timeout(10000),
          body,
          params: { path: { id }, header: { ...header, 'Idempotency-Key': key } },
        }),
      CommentResponseSchema,
      messages,
    ).catch(failed),
  delete: (accountId: string, id: string, expectedRevision: number, key: string) =>
    authenticatedWriteFor(
      accountId,
      (header) =>
        deleteComment({
          ...sessionRequestOptions,
          headers: expected(accountId),
          signal: AbortSignal.timeout(10000),
          body: { expectedRevision },
          params: { path: { id }, header: { ...header, 'Idempotency-Key': key } },
        }),
      CommentActionResponseSchema,
      messages,
    ).catch(failed),
  queue: (
    accountId: string,
    query: z.infer<typeof CommentModerationQuerySchema>,
    signal: AbortSignal,
  ) => {
    const { personaId, ...filters } = query;
    return getModerationComments({
      ...sessionRequestOptions,
      headers: expected(accountId),
      signal: timeout(signal),
      params: { query: { ...filters, ...(personaId === undefined ? {} : { personaId }) } },
    })
      .then((result) => checkedResponse(result, CommentModerationResponseSchema))
      .catch(failed);
  },
  detail: (accountId: string, id: string, signal: AbortSignal) =>
    getModerationComment({
      ...sessionRequestOptions,
      headers: expected(accountId),
      signal: timeout(signal),
      params: { path: { id } },
    })
      .then((result) => checkedResponse(result, AdminCommentResponseSchema))
      .catch(failed),
  review: (accountId: string, id: string, body: z.infer<typeof ReviewCommentSchema>, key: string) =>
    authenticatedWriteFor(
      accountId,
      (header) =>
        reviewComment({
          ...sessionRequestOptions,
          headers: expected(accountId),
          signal: AbortSignal.timeout(10000),
          body,
          params: { path: { id }, header: { ...header, 'Idempotency-Key': key } },
        }),
      AdminCommentResponseSchema,
      messages,
    ).catch(failed),
  bulk: (accountId: string, body: z.infer<typeof BulkReviewCommentsSchema>, key: string) =>
    authenticatedWriteFor(
      accountId,
      (header) =>
        reviewCommentsBatch({
          ...sessionRequestOptions,
          headers: expected(accountId),
          signal: AbortSignal.timeout(15000),
          body,
          params: { header: { ...header, 'Idempotency-Key': key } },
        }),
      BulkReviewCommentsResponseSchema,
      messages,
    ).catch(failed),
  visibility: (
    accountId: string,
    id: string,
    body: z.infer<typeof CommentVisibilitySchema>,
    key: string,
  ) =>
    authenticatedWriteFor(
      accountId,
      (header) =>
        setCommentVisibility({
          ...sessionRequestOptions,
          headers: expected(accountId),
          signal: AbortSignal.timeout(10000),
          body,
          params: { path: { id }, header: { ...header, 'Idempotency-Key': key } },
        }),
      AdminCommentResponseSchema,
      messages,
    ).catch(failed),
};
