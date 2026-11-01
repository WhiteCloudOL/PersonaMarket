import type {
  PolicyDraftFields,
  PolicySlug,
  PolicySubmissionStatus,
  PolicyRecord,
  PolicySubmission,
} from '@personamarket/contracts';

export const policyLabels: Record<PolicySlug, string> = {
  terms: '服务条款',
  privacy: '隐私说明',
  'content-policy': '投稿与转载规则',
};
export const policyStatuses: Record<PolicySubmissionStatus, string> = {
  pending: '待审核',
  approved: '已批准',
  rejected: '已驳回',
  withdrawn: '已撤回',
};
export const policyActions: Record<PolicyRecord['action'], string> = {
  edited: '保存草稿',
  submitted: '提交审核',
  approved: '审核通过',
  rejected: '审核驳回',
  withdrawn: '撤回送审',
  unpublished: '下线公开版',
  activated: '激活批准版',
};
export function policyFields(value: PolicyDraftFields): PolicyDraftFields {
  return { title: value.title, summary: value.summary, bodyMarkdown: value.bodyMarkdown };
}
export type PolicyIntent =
  | { kind: 'submit'; revision: number }
  | { kind: 'unpublish'; revision: number }
  | {
      kind: 'withdraw';
      revision: number;
      submission: PolicySubmission;
    }
  | {
      kind: 'activate';
      revision: number;
      submission: PolicySubmission;
    }
  | {
      kind: 'review';
      revision: number;
      submission: PolicySubmission;
      decision: 'approve' | 'reject';
    };
export const intentKey = (intent: PolicyIntent) =>
  intent.kind +
  ('submission' in intent ? ':' + intent.submission.id : '') +
  (intent.kind === 'review' ? ':' + intent.decision : '');
export function intentLabel(intent: PolicyIntent) {
  return intent.kind === 'submit'
    ? '提交规则审核'
    : intent.kind === 'unpublish'
      ? '下线当前公开版'
      : intent.kind === 'withdraw'
        ? '撤回待审快照'
        : intent.kind === 'activate'
          ? '激活历史批准版'
          : intent.decision === 'approve'
            ? '批准并公开规则'
            : '驳回送审快照';
}
export type PolicyActionValues = { reason: string; selfReviewConfirmed: boolean };
