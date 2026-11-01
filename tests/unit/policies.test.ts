import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  PolicySlugSchema,
  PolicyParamsSchema,
  PolicyReadQuerySchema,
  PolicyDraftFieldsSchema,
  PolicyFieldsSchema,
  PolicyWriteSchema,
  SubmitPolicySchema,
  WithdrawPolicySchema,
  UnpublishPolicySchema,
  ActivatePolicySchema,
  ReviewPolicySchema,
  PolicySubmissionStatusSchema,
  policyNextSubmissionStatus,
  policyEtag,
  PublicPolicySchema,
  PublicPolicyResponseSchema,
  PublicPoliciesResponseSchema,
  PolicySubmissionSchema,
  PolicySubmissionResponseSchema,
  ManagedPolicySchema,
  PolicyRecordActionSchema,
  PolicyRecordSnapshotSchema,
  PolicyRecordSummarySchema,
  PolicyRecordResponseSchema,
  PolicyRecordsResponseSchema,
  PolicyRecordsQuerySchema,
  PolicySubmissionsQuerySchema,
} from '@personamarket/contracts';

const fields = {
  title: '契约测试标题',
  summary: '仅用于结构校验',
  bodyMarkdown: '  # 契约测试\n\n保留 Markdown 原始空白🌟  ',
};
const timestamp = '2026-11-01T00:00:00.000Z';
const author = { id: randomUUID(), username: 'fixture_policy_author' };
const publication = {
  ...fields,
  slug: 'terms',
  publicationId: randomUUID(),
  publishedAt: timestamp,
  activatedAt: timestamp,
};
const action = { reason: '核对操作范围', confirmed: true };

it('仅允许三类独立规则，沿用递增修订和UUID版本标识', () => {
  expect(PolicySlugSchema.options).toEqual(['terms', 'privacy', 'content-policy']);
  for (const slug of PolicySlugSchema.options)
    expect(PolicyParamsSchema.parse({ slug })).toEqual({ slug });
  for (const slug of ['source-license', '../terms', 'terms/privacy', 'TERMS', ''])
    expect(PolicySlugSchema.safeParse(slug).success).toBe(false);
  expect(PolicyParamsSchema.safeParse({ slug: 'terms', role: 'admin' }).success).toBe(false);
  expect(policyEtag('content-policy', 12)).toBe('"policy-content-policy-12"');
});

it('初始私有草稿可留空，完整快照不接受空白标题或正文，也不生成默认正文', () => {
  const empty = { title: '', summary: '', bodyMarkdown: '' };
  expect(PolicyDraftFieldsSchema.parse(empty)).toEqual(empty);
  expect(PolicyDraftFieldsSchema.safeParse({}).success).toBe(false);
  expect(PolicyFieldsSchema.safeParse(empty).success).toBe(false);
  expect(PolicyFieldsSchema.parse(fields)).toEqual(fields);
  expect(PolicyFieldsSchema.safeParse({ ...fields, title: ' ' }).success).toBe(false);
  expect(PolicyFieldsSchema.safeParse({ ...fields, bodyMarkdown: ' \n\t' }).success).toBe(false);
  expect(
    ManagedPolicySchema.safeParse({
      ...empty,
      slug: 'privacy',
      revision: 1,
      updatedAt: null,
      updatedBy: null,
      published: null,
      latestSubmission: null,
      hasUnpublishedChanges: true,
    }).success,
  ).toBe(true);
});

it('文字复用指南的Unicode边界和控制字符规则，保存不裁剪Markdown', () => {
  expect(PolicyFieldsSchema.safeParse({ ...fields, title: '🌟'.repeat(160) }).success).toBe(true);
  expect(PolicyFieldsSchema.safeParse({ ...fields, title: '🌟'.repeat(161) }).success).toBe(false);
  expect(PolicyFieldsSchema.safeParse({ ...fields, summary: '🌟'.repeat(301) }).success).toBe(
    false,
  );
  expect(
    PolicyFieldsSchema.safeParse({ ...fields, bodyMarkdown: '🌟'.repeat(30000) }).success,
  ).toBe(true);
  expect(
    PolicyFieldsSchema.safeParse({ ...fields, bodyMarkdown: '🌟'.repeat(30001) }).success,
  ).toBe(false);
  for (const title of [' 首尾空白', '首尾空白 ', '标题\n换行', '标题\0'])
    expect(PolicyFieldsSchema.safeParse({ ...fields, title }).success).toBe(false);
  expect(PolicyFieldsSchema.safeParse({ ...fields, bodyMarkdown: '正文\0' }).success).toBe(false);
  expect(PolicyFieldsSchema.parse({ ...fields, bodyMarkdown: '\t正文\r\n' }).bodyMarkdown).toBe(
    '\t正文\r\n',
  );
});

it('草稿操作不接受正文中的身份、状态、CAS或幂等元数据', () => {
  const input = { ...fields, reason: '保留操作原因' };
  expect(PolicyWriteSchema.parse(input)).toEqual(input);
  for (const extra of [
    { expectedRevision: 1 },
    { expectedAccountId: author.id },
    { idempotencyKey: randomUUID() },
    { actorId: author.id },
    { contributorIds: [author.id] },
    { status: 'approved' },
    { selfReviewRequired: false },
    { publicationId: randomUUID() },
  ])
    expect(PolicyWriteSchema.safeParse({ ...input, ...extra }).success).toBe(false);
  for (const reason of ['', ' \n ', '\0', '🌟'.repeat(2001)])
    expect(PolicyWriteSchema.safeParse({ ...input, reason }).success).toBe(false);
});

it('送审、撤回、下线及激活分开确认，激活只接收候选UUID而不接收待发布正文', () => {
  for (const schema of [SubmitPolicySchema, WithdrawPolicySchema, UnpublishPolicySchema]) {
    expect(schema.parse(action)).toEqual(action);
    expect(schema.safeParse({ reason: action.reason }).success).toBe(false);
    expect(schema.safeParse({ ...action, confirmed: false }).success).toBe(false);
    expect(schema.safeParse({ ...action, reason: ' ' }).success).toBe(false);
    expect(schema.safeParse({ ...action, snapshot: fields }).success).toBe(false);
  }
  expect(
    ActivatePolicySchema.parse({ ...action, publicationId: publication.publicationId }),
  ).toEqual({ ...action, publicationId: publication.publicationId });
  expect(ActivatePolicySchema.safeParse(action).success).toBe(false);
  expect(ActivatePolicySchema.safeParse({ ...action, publicationId: '1.0.0' }).success).toBe(false);
  expect(
    ActivatePolicySchema.safeParse({
      ...action,
      publicationId: publication.publicationId,
      approved: true,
    }).success,
  ).toBe(false);
});

it('审核他人可省略通过理由，自审确认及驳回均要求非空理由，身份仍由后端判定', () => {
  const approve = { decision: 'approve', confirmed: true };
  expect(ReviewPolicySchema.parse(approve)).toEqual({
    ...approve,
    reason: '',
    selfReviewConfirmed: false,
  });
  expect(ReviewPolicySchema.safeParse({ ...approve, confirmed: false }).success).toBe(false);
  expect(
    ReviewPolicySchema.safeParse({ ...approve, decision: 'reject', reason: ' \n ' }).success,
  ).toBe(false);
  expect(ReviewPolicySchema.safeParse({ ...approve, selfReviewConfirmed: true }).success).toBe(
    false,
  );
  expect(
    ReviewPolicySchema.safeParse({
      ...approve,
      selfReviewConfirmed: true,
      reason: '明确确认实际自审原因',
    }).success,
  ).toBe(true);
  for (const extra of [
    { selfReview: false },
    { selfReviewRequired: false },
    { reviewerId: author.id },
    { snapshot: fields },
  ])
    expect(ReviewPolicySchema.safeParse({ ...approve, ...extra }).success).toBe(false);
});

it('仅待审状态可批准、驳回或撤回，批准后不会因下线和重新激活改变审批状态', () => {
  expect(policyNextSubmissionStatus('pending', 'approve')).toBe('approved');
  expect(policyNextSubmissionStatus('pending', 'reject')).toBe('rejected');
  expect(policyNextSubmissionStatus('pending', 'withdraw')).toBe('withdrawn');
  for (const status of ['approved', 'rejected', 'withdrawn'] as const)
    for (const command of ['approve', 'reject', 'withdraw'] as const)
      expect(policyNextSubmissionStatus(status, command)).toBeNull();
  expect(PolicySubmissionStatusSchema.safeParse('published').success).toBe(false);
  expect(PolicySubmissionStatusSchema.safeParse('unpublished').success).toBe(false);
  for (const command of ['withdrawn', 'unpublished', 'activated'])
    expect(PolicyRecordActionSchema.safeParse(command).success).toBe(true);
});

it('公开白名单只包含已发布正文及版本标识，拒绝待审内容、私有理由和账号信息', () => {
  expect(PublicPolicySchema.parse(publication)).toEqual(publication);
  expect(PublicPolicyResponseSchema.parse({ data: publication }).data).toEqual(publication);
  for (const extra of [
    { draft: fields },
    { pendingBodyMarkdown: '私有待审字符串' },
    { snapshot: fields },
    { reason: '私有处理原因' },
    { submittedBy: author },
    { updatedBy: author.username },
    { contributorIds: [author.id] },
    { status: 'pending' },
    { selfReview: true },
    { selfReviewRequired: true },
  ])
    expect(PublicPolicySchema.safeParse({ ...publication, ...extra }).success).toBe(false);
  expect(
    PublicPolicyResponseSchema.safeParse({ data: publication, privateNote: '私有备注' }).success,
  ).toBe(false);
  const { bodyMarkdown, ...summary } = publication;
  expect(bodyMarkdown).toBe(fields.bodyMarkdown);
  expect(PublicPoliciesResponseSchema.parse({ data: [summary] }).data).toEqual([summary]);
  expect(
    PublicPoliciesResponseSchema.safeParse({
      data: Array.from({ length: 4 }, () => summary),
    }).success,
  ).toBe(false);
});

it('私有送审快照含来源修订，未知内部谱系不能经DTO随意透传', () => {
  const submission = {
    id: publication.publicationId,
    slug: 'terms',
    sourceRevision: 2,
    contentHash: 'a'.repeat(64),
    status: 'pending',
    submittedBy: author,
    submittedAt: timestamp,
    reviewedBy: null,
    reviewedAt: null,
    selfReview: false,
    selfReviewRequired: true,
    snapshot: fields,
    reason: null,
  };
  expect(PolicySubmissionSchema.parse(submission)).toEqual(submission);
  const reviewed = {
    ...submission,
    status: 'approved',
    reviewedBy: author,
    reviewedAt: timestamp,
    reason: '已明确确认历史自审',
    selfReview: true,
    selfReviewRequired: false,
  };
  expect(PolicySubmissionSchema.parse(reviewed).selfReview).toBe(true);
  expect(PolicySubmissionSchema.parse(reviewed).selfReviewRequired).toBe(false);
  for (const selfReviewRequired of [undefined, 'true', 1])
    expect(PolicySubmissionSchema.safeParse({ ...submission, selfReviewRequired }).success).toBe(
      false,
    );
  expect(
    PolicySubmissionResponseSchema.parse({ data: submission, meta: { revision: 3 } }).meta.revision,
  ).toBe(3);
  expect(PolicySubmissionSchema.safeParse({ ...submission, sourceRevision: 0 }).success).toBe(
    false,
  );
  expect(
    PolicySubmissionSchema.safeParse({ ...submission, contributorIds: [author.id] }).success,
  ).toBe(false);
  expect(
    PolicySubmissionSchema.safeParse({ ...submission, snapshot: { ...fields, bodyMarkdown: '' } })
      .success,
  ).toBe(false);
});

it('历史快照的公开指针及送审状态成对，分页有界且不接受未知条件', () => {
  const snapshot = {
    ...fields,
    revision: 3,
    contentHash: 'b'.repeat(64),
    publishedId: null,
    publishedContentHash: null,
    latestSubmissionId: null,
    latestSubmissionStatus: null,
  };
  expect(PolicyRecordSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  expect(
    PolicyRecordSnapshotSchema.safeParse({ ...snapshot, publishedId: publication.publicationId })
      .success,
  ).toBe(false);
  expect(
    PolicyRecordSnapshotSchema.safeParse({ ...snapshot, latestSubmissionStatus: 'pending' })
      .success,
  ).toBe(false);
  expect(PolicyRecordsQuerySchema.parse({})).toEqual({ page: 1 });
  expect(PolicySubmissionsQuerySchema.parse({})).toEqual({ page: 1, status: 'all' });
  for (const page of [0, 101, 1.5, Number.POSITIVE_INFINITY])
    expect(PolicyRecordsQuerySchema.safeParse({ page }).success).toBe(false);
  expect(PolicyRecordsQuerySchema.safeParse({ page: 1, pageSize: 100 }).success).toBe(false);
  expect(PolicySubmissionsQuerySchema.safeParse({ status: 'published' }).success).toBe(false);
});

it('公开读取只接受可选UUID核对，版本的当前公开资格由后端校验', () => {
  expect(PolicyReadQuerySchema.parse({})).toEqual({});
  expect(PolicyReadQuerySchema.parse({ publicationId: publication.publicationId })).toEqual({
    publicationId: publication.publicationId,
  });
  for (const input of [
    { publicationId: null },
    { publicationId: '1.0.0' },
    { publicationId: '' },
    { publicationId: publication.publicationId, includeHistory: true },
    { status: 'approved' },
  ])
    expect(PolicyReadQuerySchema.safeParse(input).success).toBe(false);
});

it('公开首次批准和激活时间均必填且原样保留，不以默认时间补缺', () => {
  const reactivated = { ...publication, activatedAt: '2026-11-02T00:00:00.000Z' };
  const parsed = PublicPolicySchema.parse(reactivated);
  expect(parsed.publicationId).toBe(publication.publicationId);
  expect(parsed.publishedAt).toBe(timestamp);
  expect(parsed.activatedAt).toBe(reactivated.activatedAt);
  for (const input of [
    { ...publication, publishedAt: undefined },
    { ...publication, activatedAt: undefined },
    { ...publication, activatedAt: null },
    { ...publication, activatedAt: '明天' },
  ])
    expect(PublicPolicySchema.safeParse(input).success).toBe(false);
});

it('修改记录列表仅接收轻量摘要，完整历史正文由独立详情响应提供', () => {
  const before = {
    ...fields,
    revision: 3,
    contentHash: 'a'.repeat(64),
    publishedId: null,
    publishedContentHash: null,
    latestSubmissionId: null,
    latestSubmissionStatus: null,
  };
  const after = {
    ...before,
    revision: 4,
    publishedId: publication.publicationId,
    publishedContentHash: 'b'.repeat(64),
  };
  const record = {
    id: randomUUID(),
    actor: author,
    action: 'activated',
    submissionId: publication.publicationId,
    reason: '激活已批准快照',
    selfReview: false,
    before,
    after,
    createdAt: timestamp,
  };
  const summary = {
    id: record.id,
    actor: record.actor,
    action: record.action,
    submissionId: record.submissionId,
    reason: record.reason,
    selfReview: record.selfReview,
    createdAt: record.createdAt,
    fromRevision: before.revision,
    toRevision: after.revision,
  };
  const meta = { page: 1, pageSize: 20, total: 1 };
  expect(PolicyRecordSummarySchema.parse(summary)).toEqual(summary);
  expect(PolicyRecordsResponseSchema.parse({ data: [summary], meta }).data).toEqual([summary]);
  expect(PolicyRecordResponseSchema.parse({ data: record }).data).toEqual(record);
  expect(PolicyRecordSummarySchema.safeParse({ ...summary, before, after }).success).toBe(false);
  expect(
    PolicyRecordSummarySchema.safeParse({ ...summary, bodyMarkdown: fields.bodyMarkdown }).success,
  ).toBe(false);
  expect(PolicyRecordsResponseSchema.safeParse({ data: [record], meta }).success).toBe(false);
  expect(PolicyRecordResponseSchema.safeParse({ data: summary }).success).toBe(false);
  for (const revisions of [
    { fromRevision: 0 },
    { fromRevision: 1.5 },
    { toRevision: 0 },
    { toRevision: 1.5 },
  ])
    expect(PolicyRecordSummarySchema.safeParse({ ...summary, ...revisions }).success).toBe(false);
  expect(
    PolicyRecordsResponseSchema.safeParse({
      data: Array.from({ length: 21 }, () => summary),
      meta: { ...meta, total: 21 },
    }).success,
  ).toBe(false);
});
