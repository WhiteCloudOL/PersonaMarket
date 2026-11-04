import {
  getAdminPolicy,
  updatePolicyDraft,
  submitPolicy,
  getPolicySubmissions,
  getPolicySubmission,
  withdrawPolicySubmission,
  reviewPolicySubmission,
  unpublishPolicy,
  activatePolicy,
  getPolicyRecords,
  getPolicyRecord,
} from '@personamarket/api-client';
import {
  AdminPolicyResponseSchema,
  PolicySubmissionsResponseSchema,
  PolicySubmissionResponseSchema,
  PolicyRecordsResponseSchema,
  PolicyRecordResponseSchema,
  policyEtag,
  type PolicySlug,
  type PolicyDraftFields,
  type SubmitPolicy,
  type WithdrawPolicy,
  type ReviewPolicy,
  type UnpublishPolicy,
  type ActivatePolicy,
  type PolicySubmissionsQuery,
} from '@personamarket/contracts';
import {
  ApiError,
  authenticatedWriteFor,
  checkedResponse,
  sessionRequestOptions,
} from '@/lib/auth-api';
import { requestAuthSessionRefresh } from '@/lib/auth-session-events';

export const policiesKey = (accountId: string) => ['private', 'policies', accountId] as const;
export const policyDraftKey = (accountId: string, slug: PolicySlug) =>
  [...policiesKey(accountId), 'draft', slug] as const;
const headers = (accountId: string) => ({ 'X-Expected-Account': accountId });
const timeout = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(10000)]);
function failed(cause: unknown): never {
  if (cause instanceof ApiError) {
    if (['UNAUTHENTICATED', 'FORBIDDEN'].includes(cause.code)) requestAuthSessionRefresh();
    throw cause;
  }
  throw new Error('公共规则暂时无法读取或保存，请核对状态后重试', { cause });
}
export type PolicyCommand =
  | { kind: 'write'; input: PolicyDraftFields }
  | { kind: 'submit'; input: SubmitPolicy }
  | { kind: 'withdraw'; id: string; input: WithdrawPolicy }
  | { kind: 'review'; id: string; input: ReviewPolicy }
  | { kind: 'unpublish'; input: UnpublishPolicy }
  | { kind: 'activate'; input: ActivatePolicy };

export const policiesApi = {
  read: (accountId: string, slug: PolicySlug, signal: AbortSignal) =>
    getAdminPolicy({
      ...sessionRequestOptions,
      headers: headers(accountId),
      signal: timeout(signal),
      params: { path: { slug } },
    })
      .then((result) => checkedResponse(result, AdminPolicyResponseSchema))
      .catch(failed),
  submissions: (
    accountId: string,
    slug: PolicySlug,
    query: PolicySubmissionsQuery,
    signal: AbortSignal,
  ) =>
    getPolicySubmissions({
      ...sessionRequestOptions,
      headers: headers(accountId),
      signal: timeout(signal),
      params: { path: { slug }, query },
    })
      .then((result) => checkedResponse(result, PolicySubmissionsResponseSchema))
      .catch(failed),
  submission: (accountId: string, slug: PolicySlug, id: string, signal: AbortSignal) =>
    getPolicySubmission({
      ...sessionRequestOptions,
      headers: headers(accountId),
      signal: timeout(signal),
      params: { path: { slug, id } },
    })
      .then((result) => checkedResponse(result, PolicySubmissionResponseSchema))
      .catch(failed),
  records: (accountId: string, slug: PolicySlug, page: number, signal: AbortSignal) =>
    getPolicyRecords({
      ...sessionRequestOptions,
      headers: headers(accountId),
      signal: timeout(signal),
      params: { path: { slug }, query: { page } },
    })
      .then((result) => checkedResponse(result, PolicyRecordsResponseSchema))
      .catch(failed),
  record: (accountId: string, slug: PolicySlug, id: string, signal: AbortSignal) =>
    getPolicyRecord({
      ...sessionRequestOptions,
      headers: headers(accountId),
      signal: timeout(signal),
      params: { path: { slug, id } },
    })
      .then((result) => checkedResponse(result, PolicyRecordResponseSchema))
      .catch(failed),
  mutate: (
    accountId: string,
    slug: PolicySlug,
    revision: number,
    command: PolicyCommand,
    key: string,
  ) =>
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
          'If-Match': policyEtag(slug, revision),
          'Idempotency-Key': key,
        };
        const path = { slug };
        switch (command.kind) {
          case 'write':
            return updatePolicyDraft({ ...common, body: command.input, params: { path, header } });
          case 'submit':
            return submitPolicy({ ...common, body: command.input, params: { path, header } });
          case 'withdraw':
            return withdrawPolicySubmission({
              ...common,
              body: command.input,
              params: { path: { ...path, id: command.id }, header },
            });
          case 'review':
            return reviewPolicySubmission({
              ...common,
              body: command.input,
              params: { path: { ...path, id: command.id }, header },
            });
          case 'unpublish':
            return unpublishPolicy({ ...common, body: command.input, params: { path, header } });
          case 'activate':
            return activatePolicy({ ...common, body: command.input, params: { path, header } });
        }
      },
      AdminPolicyResponseSchema,
      {
        accountChanged: '登录账号已变化，请重新核对公共规则',
        verificationRequired: '请先完成登录验证，再维护公共规则',
      },
    ).catch(failed),
};
