import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  AdminPoliciesResponseSchema,
  AdminPolicyResponseSchema,
  AdminUserResponseSchema,
  ErrorResponseSchema,
  MfaSetupResponseSchema,
  PolicyFieldsSchema,
  PolicyRecordResponseSchema,
  PolicyRecordsResponseSchema,
  PolicySlugSchema,
  PolicySubmissionResponseSchema,
  PolicySubmissionsResponseSchema,
  PublicPoliciesResponseSchema,
  PublicPolicyResponseSchema,
  canonicalJson,
  policyEtag,
  type ManagedPolicy,
  type PolicyDraftFields,
  type PolicySlug,
} from '@personamarket/contracts';
import { createAdministrator, createTotp } from '@personamarket/server';
import { createAuthStack } from '../fixtures/auth-stack.js';
import type { AuthHttp } from '../fixtures/auth-http.js';
import { verifiedCreator } from '../fixtures/creator.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});

const base = '/api/v1/admin/settings/policies';
const publicBase = '/api/v1/policies';
const firstFields: PolicyDraftFields = {
  title: '契约集成测试标题',
  summary: '仅供隔离测试的第一份内容',
  bodyMarkdown: '  # 契约集成测试\n\n保留第一份 Markdown 原始空白🌟  ',
};
const secondFields: PolicyDraftFields = {
  ...firstFields,
  summary: '仅供隔离测试的第二份内容',
  bodyMarkdown: '# 契约集成测试\n\n第二份冻结内容',
};
const thirdFields: PolicyDraftFields = {
  ...secondFields,
  bodyMarkdown: '# 契约集成测试\n\n仍未批准的后续私有草稿',
};
type CommandOptions = { key?: string; headers?: Record<string, string> };
const command = (
  http: AuthHttp,
  slug: PolicySlug,
  revision: number,
  suffix: string,
  body: unknown,
  method = 'POST',
  options: CommandOptions = {},
) =>
  http.write(base + '/' + slug + suffix, body, method, {
    'If-Match': policyEtag(slug, revision),
    'Idempotency-Key': options.key ?? randomUUID(),
    ...options.headers,
  });
const save = (
  http: AuthHttp,
  slug: PolicySlug,
  revision: number,
  fields = firstFields,
  options: CommandOptions = {},
) => command(http, slug, revision, '', { ...fields, reason: '核对本次草稿变化' }, 'PATCH', options);
const submit = (http: AuthHttp, slug: PolicySlug, revision: number, options: CommandOptions = {}) =>
  command(
    http,
    slug,
    revision,
    '/submissions',
    { reason: '确认冻结本次送审内容', confirmed: true },
    'POST',
    options,
  );
type ReviewOptions = CommandOptions & {
  decision?: 'approve' | 'reject';
  reason?: string;
  selfReviewConfirmed?: boolean;
};
const review = (
  http: AuthHttp,
  slug: PolicySlug,
  revision: number,
  id: string,
  options: ReviewOptions = {},
) =>
  command(
    http,
    slug,
    revision,
    '/submissions/' + id + '/review',
    {
      decision: options.decision ?? 'approve',
      reason: options.reason ?? '独立核对本次冻结快照',
      confirmed: true,
      selfReviewConfirmed: options.selfReviewConfirmed ?? false,
    },
    'POST',
    options,
  );

async function accepted(response: Response, slug: PolicySlug = 'terms') {
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body = AdminPolicyResponseSchema.parse(await response.json());
  expect(response.headers.get('etag')).toBe(policyEtag(slug, body.data.revision));
  return body.data;
}
async function managed(http: AuthHttp, slug: PolicySlug = 'terms') {
  return accepted(await http.raw(base + '/' + slug), slug);
}
function latest(value: ManagedPolicy) {
  if (!value.latestSubmission) throw new Error('缺少真实送审快照');
  return value.latestSubmission;
}
async function published(http: AuthHttp, slug: PolicySlug = 'terms', id?: string) {
  const response = await http.raw(
    publicBase + '/' + slug + (id ? '?publicationId=' + encodeURIComponent(id) : ''),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  return PublicPolicyResponseSchema.parse(await response.json()).data;
}
async function submission(http: AuthHttp, id: string, slug: PolicySlug = 'terms') {
  const response = await http.raw(base + '/' + slug + '/submissions/' + id);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body = PolicySubmissionResponseSchema.parse(await response.json());
  expect(response.headers.get('etag')).toBe(policyEtag(slug, body.meta.revision));
  return body;
}
async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(code);
}
async function effects() {
  const result = await stack.owner.pool.query<{
    records: number;
    submissions: number;
    audits: number;
    commands: number;
  }>(
    'SELECT ' +
      '(SELECT count(*)::integer FROM policy_records) AS records,' +
      '(SELECT count(*)::integer FROM policy_submissions) AS submissions,' +
      "(SELECT count(*)::integer FROM auth_audit_events WHERE event LIKE 'policy.%') AS audits," +
      "(SELECT count(*)::integer FROM idempotency_keys WHERE operation LIKE 'policy.%') AS commands",
  );
  const row = result.rows[0];
  if (!row) throw new Error('缺少真实规则业务计数');
  return row;
}
async function storedSnapshot(id: string) {
  const result = await stack.owner.pool.query<{
    snapshot: unknown;
    contributors: string[];
    content_hash: string;
    source_revision: number;
  }>(
    'SELECT snapshot,contributors,content_hash,source_revision FROM policy_submissions WHERE id=$1',
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new Error('缺少已保存规则快照');
  return row;
}
async function adminAccount(withMfa = false) {
  const username = 'policy_' + randomUUID().replaceAll('-', '').slice(0, 12);
  const credentials = {
    username,
    email: username + '@fixture.invalid',
    password: 'A controlled policy administrator passphrase 2026',
  };
  await createAdministrator(stack.owner, credentials);
  const http = stack.browser();
  expect(
    (
      await http.write('/api/v1/auth/login', {
        identifier: credentials.username,
        password: credentials.password,
      })
    ).status,
  ).toBe(200);
  let secret: string | undefined;
  if (withMfa) {
    const setupResponse = await http.write('/api/v1/auth/mfa/setup');
    expect(setupResponse.status).toBe(200);
    secret = MfaSetupResponseSchema.parse(await setupResponse.json()).data.secret;
    expect(
      (
        await http.write('/api/v1/auth/mfa/confirm', {
          code: createTotp(secret, username).generate(),
        })
      ).status,
    ).toBe(200);
  }
  const account = (await http.context()).data.account;
  if (!account) throw new Error('缺少隔离管理员账号');
  return { http, credentials, id: account.id, secret };
}
async function ageSession(userId: string) {
  // 仅调整本用例受控账号的凭据时间，验证既有十分钟身份策略
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET created_at=clock_timestamp()-interval '20 minutes',mfa_verified_at=CASE WHEN mfa_verified_at IS NULL THEN NULL ELSE clock_timestamp()-interval '20 minutes' END WHERE user_id=$1 AND revoked_at IS NULL",
    [userId],
  );
}
async function activeSession(userId: string) {
  const result = await stack.owner.pool.query<{ id: string }>(
    'SELECT id FROM auth_sessions WHERE user_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC,id DESC',
    [userId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('缺少受控有效会话');
  return row.id;
}
async function expectRotated(previousId: string, userId: string) {
  expect(await activeSession(userId)).not.toBe(previousId);
  const old = await stack.owner.pool.query<{ revoked_at: Date | null }>(
    'SELECT revoked_at FROM auth_sessions WHERE id=$1',
    [previousId],
  );
  expect(old.rows[0]?.revoked_at).toBeInstanceOf(Date);
}

it('三类规则初始化为空稿且无公开正文，读取ETag、空历史与缓存边界真实一致', async () => {
  const guest = stack.browser();
  const listResponse = await guest.raw(publicBase);
  expect(listResponse.status).toBe(200);
  expect(listResponse.headers.get('cache-control')).toBe('no-store');
  expect(PublicPoliciesResponseSchema.parse(await listResponse.json())).toEqual({ data: [] });
  const admin = await adminAccount();
  const management = await admin.http.raw(base);
  expect(management.status).toBe(200);
  const all = AdminPoliciesResponseSchema.parse(await management.json());
  expect(all.data.map((row) => row.slug)).toEqual(PolicySlugSchema.options);
  for (const slug of PolicySlugSchema.options) {
    expect(await managed(admin.http, slug)).toMatchObject({
      slug,
      title: '',
      summary: '',
      bodyMarkdown: '',
      revision: 1,
      updatedAt: null,
      updatedBy: null,
      published: null,
      latestSubmission: null,
      hasUnpublishedChanges: false,
    });
    await expectError(await guest.raw(publicBase + '/' + slug), 404, 'NOT_FOUND');
    const records = await admin.http.raw(base + '/' + slug + '/records');
    expect(records.status).toBe(200);
    expect(PolicyRecordsResponseSchema.parse(await records.json())).toEqual({
      data: [],
      meta: { page: 1, pageSize: 20, total: 0 },
    });
    const submissions = await admin.http.raw(base + '/' + slug + '/submissions');
    expect(submissions.status).toBe(200);
    expect(submissions.headers.get('etag')).toBe(policyEtag(slug, 1));
    expect(PolicySubmissionsResponseSchema.parse(await submissions.json())).toEqual({
      data: [],
      meta: { page: 1, pageSize: 20, total: 0, revision: 1 },
    });
  }
  await expectError(await submit(admin.http, 'terms', 1), 422, 'VALIDATION_FAILED');
  expect(await effects()).toEqual({ records: 0, submissions: 0, audits: 0, commands: 0 });
});

it('匿名、普通用户和审核员不能读取私有规则或执行任一管理命令', async () => {
  const id = randomUUID();
  const assertDenied = async (http: AuthHttp, status: number) => {
    for (const suffix of [
      '',
      '/terms',
      '/terms/submissions',
      '/terms/submissions/' + id,
      '/terms/records',
      '/terms/records/' + id,
    ])
      expect((await http.raw(base + suffix)).status).toBe(status);
    const actions = [
      ['', { ...firstFields, reason: '验证管理权限' }, 'PATCH'],
      ['/submissions', { reason: '验证管理权限', confirmed: true }, 'POST'],
      ['/submissions/' + id + '/withdraw', { reason: '验证管理权限', confirmed: true }, 'POST'],
      [
        '/submissions/' + id + '/review',
        { decision: 'approve', reason: '验证管理权限', confirmed: true },
        'POST',
      ],
      ['/actions/unpublish', { reason: '验证管理权限', confirmed: true }, 'POST'],
      ['/actions/activate', { publicationId: id, reason: '验证管理权限', confirmed: true }, 'POST'],
    ] as const;
    for (const [suffix, body, method] of actions)
      expect((await command(http, 'terms', 1, suffix, body, method)).status).toBe(status);
  };
  await assertDenied(stack.browser(), 401);
  const user = await verifiedCreator(stack);
  await assertDenied(user.http, 403);
  const admin = await adminAccount();
  const account = (await user.http.context()).data.account;
  if (!account) throw new Error('缺少普通用户夹具');
  const detail = await admin.http.raw('/api/v1/admin/users/' + account.id);
  expect(detail.status).toBe(200);
  const managedUser = AdminUserResponseSchema.parse(await detail.json()).data;
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/users/' + account.id + '/role',
        {
          role: 'moderator',
          expectedSecurityVersion: managedUser.securityVersion,
          reason: '准备隔离审核员权限夹具',
        },
        'PUT',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await user.http.write('/api/v1/auth/login', {
        identifier: user.username,
        password: user.password,
      })
    ).status,
  ).toBe(200);
  expect((await user.http.context()).data.account?.role).toBe('moderator');
  await assertDenied(user.http, 403);
  expect(await effects()).toEqual({ records: 0, submissions: 0, audits: 0, commands: 0 });
});

it('过期近期凭据不限制普通草稿和他人审核，待审及后续编辑不改变旧公开版或冻结正文', async () => {
  const author = await adminAccount(true);
  const reviewer = await adminAccount();
  const guest = stack.browser();
  await ageSession(author.id);
  await ageSession(reviewer.id);
  let state = await accepted(await save(author.http, 'terms', 1));
  expect(state.updatedBy).toBe(author.credentials.username);
  state = await accepted(await submit(author.http, 'terms', state.revision));
  const firstId = latest(state).id;
  expect((await submission(author.http, firstId)).data.selfReviewRequired).toBe(true);
  expect((await submission(reviewer.http, firstId)).data.selfReviewRequired).toBe(false);
  state = await accepted(
    await review(reviewer.http, 'terms', state.revision, firstId, { reason: '' }),
  );
  const original = await published(guest);
  expect(original).toMatchObject({ ...firstFields, publicationId: firstId });
  expect(state.hasUnpublishedChanges).toBe(false);
  expect((await submission(author.http, firstId)).data).toMatchObject({
    submittedBy: { id: author.id },
    reviewedBy: { id: reviewer.id },
    selfReview: false,
    selfReviewRequired: false,
  });
  const publicList = await guest.raw(publicBase);
  expect(publicList.status).toBe(200);
  expect(PublicPoliciesResponseSchema.parse(await publicList.json()).data).toEqual([
    {
      title: original.title,
      summary: original.summary,
      slug: original.slug,
      publicationId: original.publicationId,
      publishedAt: original.publishedAt,
      activatedAt: original.activatedAt,
    },
  ]);

  state = await accepted(await save(author.http, 'terms', state.revision, secondFields));
  expect(await published(guest)).toEqual(original);
  expect(state.published).toEqual(original);
  state = await accepted(await submit(author.http, 'terms', state.revision));
  const secondId = latest(state).id;
  const frozen = await storedSnapshot(secondId);
  expect(frozen.source_revision).toBe(state.revision - 1);
  expect(PolicyFieldsSchema.parse(frozen.snapshot)).toEqual(secondFields);
  expect(frozen.content_hash).toBe(
    createHash('sha256').update(canonicalJson(secondFields)).digest('hex'),
  );
  expect(await published(guest, 'terms', firstId)).toEqual(original);
  await expectError(
    await guest.raw(publicBase + '/terms?publicationId=' + secondId),
    404,
    'NOT_FOUND',
  );
  state = await accepted(await save(author.http, 'terms', state.revision, thirdFields));
  expect(await storedSnapshot(secondId)).toEqual(frozen);
  expect((await submission(reviewer.http, secondId)).data.snapshot).toEqual(secondFields);
  expect(await published(guest)).toEqual(original);
  state = await accepted(await review(reviewer.http, 'terms', state.revision, secondId));
  expect(state.bodyMarkdown).toBe(thirdFields.bodyMarkdown);
  expect(state.hasUnpublishedChanges).toBe(true);
  expect(await published(guest, 'terms', secondId)).toMatchObject(secondFields);
  expect(await storedSnapshot(secondId)).toEqual(frozen);
  expect((await submission(author.http, firstId)).data).toMatchObject({
    snapshot: firstFields,
    status: 'approved',
    selfReview: false,
    selfReviewRequired: false,
  });
  await expectError(
    await guest.raw(publicBase + '/terms?publicationId=' + firstId),
    404,
    'NOT_FOUND',
  );
  const response = await guest.raw(publicBase + '/terms');
  expect(response.status).toBe(200);
  const publicData = PublicPolicyResponseSchema.parse(await response.json()).data;
  expect(Object.keys(publicData).sort()).toEqual(
    [
      'title',
      'summary',
      'bodyMarkdown',
      'slug',
      'publicationId',
      'publishedAt',
      'activatedAt',
    ].sort(),
  );
});

it('驳回、撤回和换人送审均保留实际编辑者谱系，原文无变化保存不能洗掉自审身份', async () => {
  const author = await adminAccount();
  const submitter = await adminAccount();
  const independent = await adminAccount();
  await ageSession(author.id);
  await ageSession(independent.id);
  let state = await accepted(await save(author.http, 'terms', 1));
  state = await accepted(await submit(submitter.http, 'terms', state.revision));
  const rejectedId = latest(state).id;
  const rejectedFrozen = await storedSnapshot(rejectedId);
  expect(rejectedFrozen.contributors).toEqual([author.id, submitter.id].sort());
  state = await accepted(
    await review(independent.http, 'terms', state.revision, rejectedId, {
      decision: 'reject',
      reason: '隔离测试退回本次冻结内容',
    }),
  );
  const afterReject = await effects();
  await expectError(await save(submitter.http, 'terms', state.revision), 409, 'CONFLICT');
  expect(await effects()).toEqual(afterReject);
  state = await accepted(await submit(submitter.http, 'terms', state.revision));
  const withdrawnId = latest(state).id;
  const withdrawnFrozen = await storedSnapshot(withdrawnId);
  expect(withdrawnFrozen.contributors).toEqual(rejectedFrozen.contributors);
  state = await accepted(
    await command(
      submitter.http,
      'terms',
      state.revision,
      '/submissions/' + withdrawnId + '/withdraw',
      { reason: '撤回本次待审内容后再核对', confirmed: true },
    ),
  );
  state = await accepted(await submit(submitter.http, 'terms', state.revision));
  const pendingId = latest(state).id;
  expect((await submission(author.http, pendingId)).data.selfReviewRequired).toBe(true);
  expect((await submission(independent.http, pendingId)).data.selfReviewRequired).toBe(false);
  const beforeDenied = await effects();
  await expectError(
    await review(author.http, 'terms', state.revision, pendingId),
    403,
    'FORBIDDEN',
  );
  await expectError(
    await review(author.http, 'terms', state.revision, pendingId, {
      selfReviewConfirmed: true,
      reason: '确认原编辑者的实际自审身份',
    }),
    403,
    'REAUTH_REQUIRED',
  );
  expect(await effects()).toEqual(beforeDenied);
  expect((await submission(author.http, rejectedId)).data.status).toBe('rejected');
  expect((await submission(author.http, withdrawnId)).data.status).toBe('withdrawn');
  expect(await storedSnapshot(rejectedId)).toEqual(rejectedFrozen);
  expect(await storedSnapshot(withdrawnId)).toEqual(withdrawnFrozen);
  state = await accepted(await review(independent.http, 'terms', state.revision, pendingId));
  expect(state.published?.publicationId).toBe(pendingId);
  for (const id of [rejectedId, withdrawnId])
    await expectError(
      await stack.browser().raw(publicBase + '/terms?publicationId=' + id),
      404,
      'NOT_FOUND',
    );
});

it('待审期间的新编辑在旧快照批准后仍归入下一轮作者，不能随批准基线被清除', async () => {
  const initial = await adminAccount();
  const laterEditor = await adminAccount();
  const independent = await adminAccount();
  let state = await accepted(await save(initial.http, 'terms', 1));
  state = await accepted(await submit(initial.http, 'terms', state.revision));
  const firstId = latest(state).id;
  const firstFrozen = await storedSnapshot(firstId);
  state = await accepted(await save(laterEditor.http, 'terms', state.revision, secondFields));
  state = await accepted(await review(independent.http, 'terms', state.revision, firstId));
  expect(state.published?.bodyMarkdown).toBe(firstFields.bodyMarkdown);
  expect(state.bodyMarkdown).toBe(secondFields.bodyMarkdown);
  expect(state.hasUnpublishedChanges).toBe(true);
  expect(await storedSnapshot(firstId)).toEqual(firstFrozen);
  state = await accepted(await submit(initial.http, 'terms', state.revision));
  const nextId = latest(state).id;
  const next = await storedSnapshot(nextId);
  expect(next.contributors).toEqual([initial.id, laterEditor.id].sort());
  expect((await submission(laterEditor.http, nextId)).data.selfReviewRequired).toBe(true);
  expect((await submission(independent.http, nextId)).data.selfReviewRequired).toBe(false);
  await ageSession(laterEditor.id);
  await expectError(
    await review(laterEditor.http, 'terms', state.revision, nextId, {
      selfReviewConfirmed: true,
      reason: '确认待审后新编辑者的身份',
    }),
    403,
    'REAUTH_REQUIRED',
  );
  expect((await submission(laterEditor.http, nextId)).data.status).toBe('pending');
  state = await accepted(await review(independent.http, 'terms', state.revision, nextId));
  expect(state.published?.bodyMarkdown).toBe(secondFields.bodyMarkdown);
});

it('未绑定MFA的实际自审须当前密码确认，旋转会话后由用户显式重试原请求', async () => {
  const admin = await adminAccount();
  await ageSession(admin.id);
  let state = await accepted(await save(admin.http, 'privacy', 1), 'privacy');
  state = await accepted(await submit(admin.http, 'privacy', state.revision), 'privacy');
  const id = latest(state).id;
  const options = {
    key: randomUUID(),
    selfReviewConfirmed: true,
    reason: '逐项核对本人的冻结内容并确认自审',
  };
  const before = await effects();
  await expectError(
    await review(admin.http, 'privacy', state.revision, id, options),
    403,
    'REAUTH_REQUIRED',
  );
  expect(await effects()).toEqual(before);
  const previousSession = await activeSession(admin.id);
  expect(
    (
      await admin.http.write('/api/v1/auth/reauthenticate', {
        currentPassword: admin.credentials.password,
      })
    ).status,
  ).toBe(200);
  await expectRotated(previousSession, admin.id);
  expect((await admin.http.context()).data.mfaEnabled).toBe(false);
  expect((await submission(admin.http, id, 'privacy')).data.status).toBe('pending');
  expect(await effects()).toEqual(before);
  state = await accepted(
    await review(admin.http, 'privacy', state.revision, id, options),
    'privacy',
  );
  expect(state.published?.publicationId).toBe(id);
  expect((await submission(admin.http, id, 'privacy')).data).toMatchObject({
    selfReview: true,
    selfReviewRequired: false,
    status: 'approved',
  });
  expect((await published(stack.browser(), 'privacy', id)).publicationId).toBe(id);
});

it('已绑定MFA的自审不能密码绕过，近期MFA成功后不自动审批且历史自审结果保留', async () => {
  const admin = await adminAccount(true);
  if (!admin.secret) throw new Error('缺少本用例主动绑定的MFA夹具');
  await ageSession(admin.id);
  let state = await accepted(await save(admin.http, 'content-policy', 1), 'content-policy');
  state = await accepted(
    await submit(admin.http, 'content-policy', state.revision),
    'content-policy',
  );
  const id = latest(state).id;
  const options = {
    key: randomUUID(),
    selfReviewConfirmed: true,
    reason: '使用已绑定MFA确认本次实际自审',
  };
  const before = await effects();
  await expectError(
    await review(admin.http, 'content-policy', state.revision, id),
    403,
    'FORBIDDEN',
  );
  await expectError(
    await review(admin.http, 'content-policy', state.revision, id, options),
    403,
    'MFA_REQUIRED',
  );
  await expectError(
    await admin.http.write('/api/v1/auth/reauthenticate', {
      currentPassword: admin.credentials.password,
    }),
    403,
    'MFA_REQUIRED',
  );
  expect(await effects()).toEqual(before);
  const previousSession = await activeSession(admin.id);
  expect(
    (
      await admin.http.write('/api/v1/auth/mfa/verify', {
        code: createTotp(admin.secret, admin.credentials.username).generate({
          timestamp: Date.now() + 30000,
        }),
      })
    ).status,
  ).toBe(200);
  await expectRotated(previousSession, admin.id);
  expect((await submission(admin.http, id, 'content-policy')).data.status).toBe('pending');
  expect(await effects()).toEqual(before);
  const expectedRevision = state.revision;
  state = await accepted(
    await review(admin.http, 'content-policy', expectedRevision, id, options),
    'content-policy',
  );
  expect(state.published?.publicationId).toBe(id);
  const approved = await effects();
  await ageSession(admin.id);
  state = await accepted(
    await review(admin.http, 'content-policy', expectedRevision, id, options),
    'content-policy',
  );
  expect(await effects()).toEqual(approved);
  expect(state.published?.publicationId).toBe(id);
  expect((await submission(admin.http, id, 'content-policy')).data).toMatchObject({
    selfReview: true,
    selfReviewRequired: false,
    status: 'approved',
    reason: options.reason,
  });
  expect((await published(stack.browser(), 'content-policy', id)).publicationId).toBe(id);
  const recordsResponse = await admin.http.raw(base + '/content-policy/records');
  expect(recordsResponse.status).toBe(200);
  const records = PolicyRecordsResponseSchema.parse(await recordsResponse.json());
  expect(records.data.find((row) => row.action === 'approved')).toMatchObject({
    actor: { id: admin.id },
    submissionId: id,
    selfReview: true,
    reason: options.reason,
  });
});

it('保存、送审和审核的同修订并发各只提交一次，相同幂等键核对不产生重复业务记录', async () => {
  const first = await adminAccount();
  const second = await adminAccount();
  const saves = [
    { http: first.http, fields: firstFields, key: randomUUID() },
    { http: second.http, fields: secondFields, key: randomUUID() },
  ];
  const saveResponses = await Promise.all(
    saves.map((item) => save(item.http, 'terms', 1, item.fields, { key: item.key })),
  );
  expect(saveResponses.map((response) => response.status).sort()).toEqual([200, 412]);
  const winnerIndex = saveResponses.findIndex((response) => response.status === 200);
  const winner = saves[winnerIndex];
  const savedResponse = saveResponses[winnerIndex];
  if (!winner || !savedResponse) throw new Error('缺少真实保存竞争结果');
  let state = await accepted(savedResponse);
  for (const response of saveResponses.filter((item) => item.status === 412))
    await expectError(response, 412, 'REVISION_CONFLICT');
  expect(await effects()).toEqual({ records: 1, submissions: 0, audits: 1, commands: 1 });
  await accepted(await save(winner.http, 'terms', 1, winner.fields, { key: winner.key }));
  await expectError(
    await save(winner.http, 'terms', 1, thirdFields, { key: winner.key }),
    409,
    'CONFLICT',
  );
  expect(await effects()).toEqual({ records: 1, submissions: 0, audits: 1, commands: 1 });

  const requests = [
    { http: first.http, key: randomUUID() },
    { http: second.http, key: randomUUID() },
  ];
  const submitRevision = state.revision;
  const submitted = await Promise.all(
    requests.map((item) => submit(item.http, 'terms', submitRevision, { key: item.key })),
  );
  expect(submitted.map((response) => response.status).sort()).toEqual([200, 412]);
  const submissionIndex = submitted.findIndex((response) => response.status === 200);
  const submitting = requests[submissionIndex];
  const submissionResponse = submitted[submissionIndex];
  if (!submitting || !submissionResponse) throw new Error('缺少真实送审竞争结果');
  state = await accepted(submissionResponse);
  const id = latest(state).id;
  expect(
    (
      await accepted(
        await submit(submitting.http, 'terms', submitRevision, { key: submitting.key }),
      )
    ).latestSubmission?.id,
  ).toBe(id);
  expect(await effects()).toEqual({ records: 2, submissions: 1, audits: 2, commands: 2 });

  const reviewers = [await adminAccount(), await adminAccount()];
  const reviews = await Promise.all(
    reviewers.map((admin) => review(admin.http, 'terms', state.revision, id)),
  );
  expect(reviews.map((response) => response.status).sort()).toEqual([200, 412]);
  const approved = reviews.find((response) => response.status === 200);
  if (!approved) throw new Error('缺少真实审批竞争结果');
  state = await accepted(approved);
  expect(state.published?.publicationId).toBe(id);
  expect(await effects()).toEqual({ records: 3, submissions: 1, audits: 3, commands: 3 });
  expect((await storedSnapshot(id)).snapshot).toEqual(winner.fields);
});

it('只激活已批准快照且下线关闭旧公开URL，轻量记录列表与正文详情按需读取', async () => {
  const author = await adminAccount();
  const reviewer = await adminAccount();
  const guest = stack.browser();
  let state = await accepted(await save(author.http, 'terms', 1));
  state = await accepted(await submit(author.http, 'terms', state.revision));
  const firstId = latest(state).id;
  state = await accepted(await review(reviewer.http, 'terms', state.revision, firstId));
  const firstPublic = await published(guest);
  const firstFrozen = await storedSnapshot(firstId);
  state = await accepted(await save(author.http, 'terms', state.revision, secondFields));
  state = await accepted(await submit(author.http, 'terms', state.revision));
  const secondId = latest(state).id;
  const beforeInvalidActivation = await effects();
  await expectError(
    await command(author.http, 'terms', state.revision, '/actions/activate', {
      publicationId: secondId,
      reason: '核对待审版本边界',
      confirmed: true,
    }),
    404,
    'NOT_FOUND',
  );
  expect(await effects()).toEqual(beforeInvalidActivation);
  state = await accepted(await review(reviewer.http, 'terms', state.revision, secondId));
  await expectError(
    await guest.raw(publicBase + '/terms?publicationId=' + firstId),
    404,
    'NOT_FOUND',
  );
  state = await accepted(
    await command(author.http, 'terms', state.revision, '/actions/activate', {
      publicationId: firstId,
      reason: '重新激活旧批准快照',
      confirmed: true,
    }),
  );
  const reactivated = await published(guest, 'terms', firstId);
  expect(reactivated.publishedAt).toBe(firstPublic.publishedAt);
  expect(Date.parse(reactivated.activatedAt)).toBeGreaterThanOrEqual(
    Date.parse(firstPublic.activatedAt),
  );
  expect(reactivated.bodyMarkdown).toBe(firstFields.bodyMarkdown);
  expect(state.bodyMarkdown).toBe(secondFields.bodyMarkdown);
  await expectError(
    await guest.raw(publicBase + '/terms?publicationId=' + secondId),
    404,
    'NOT_FOUND',
  );
  state = await accepted(
    await command(author.http, 'terms', state.revision, '/actions/unpublish', {
      reason: '暂停当前规则公开展示',
      confirmed: true,
    }),
  );
  expect(state.published).toBeNull();
  for (const suffix of ['', '?publicationId=' + firstId, '?publicationId=' + secondId])
    await expectError(await guest.raw(publicBase + '/terms' + suffix), 404, 'NOT_FOUND');
  expect(
    PublicPoliciesResponseSchema.parse(await (await guest.raw(publicBase)).json()).data,
  ).toEqual([]);
  expect((await submission(author.http, firstId)).data.status).toBe('approved');
  expect((await submission(author.http, secondId)).data.status).toBe('approved');
  expect(await storedSnapshot(firstId)).toEqual(firstFrozen);
  state = await accepted(
    await command(author.http, 'terms', state.revision, '/actions/activate', {
      publicationId: firstId,
      reason: '恢复旧批准快照展示',
      confirmed: true,
    }),
  );
  expect(state.published?.publicationId).toBe(firstId);
  expect((await published(guest)).publicationId).toBe(firstId);

  const recordsResponse = await author.http.raw(base + '/terms/records');
  expect(recordsResponse.status).toBe(200);
  expect(recordsResponse.headers.get('cache-control')).toBe('no-store');
  const records = PolicyRecordsResponseSchema.parse(await recordsResponse.json());
  expect(records.meta).toEqual({ page: 1, pageSize: 20, total: 9 });
  expect(records.data.map((row) => row.action)).toEqual([
    'activated',
    'unpublished',
    'activated',
    'approved',
    'submitted',
    'edited',
    'approved',
    'submitted',
    'edited',
  ]);
  for (const row of records.data) {
    expect(Object.keys(row).sort()).toEqual(
      [
        'id',
        'actor',
        'action',
        'submissionId',
        'reason',
        'selfReview',
        'fromRevision',
        'toRevision',
        'createdAt',
      ].sort(),
    );
    expect(Object.keys(row.actor).sort()).toEqual(['id', 'username']);
    expect(row.toRevision).toBe(row.fromRevision + 1);
  }
  const firstApproval = records.data.find(
    (row) => row.action === 'approved' && row.submissionId === firstId,
  );
  if (!firstApproval) throw new Error('缺少原批准记录');
  const detailResponse = await author.http.raw(base + '/terms/records/' + firstApproval.id);
  expect(detailResponse.status).toBe(200);
  const record = PolicyRecordResponseSchema.parse(await detailResponse.json()).data;
  expect(record.actor.id).toBe(reviewer.id);
  expect(record.before.bodyMarkdown).toBe(firstFields.bodyMarkdown);
  expect(record.after.publishedId).toBe(firstId);
  expect(record.after.publishedContentHash).toBe(firstFrozen.content_hash);
  await expectError(
    await author.http.raw(base + '/privacy/records/' + firstApproval.id),
    404,
    'NOT_FOUND',
  );
  const secondPage = await author.http.raw(base + '/terms/records?page=2');
  expect(secondPage.status).toBe(200);
  expect(PolicyRecordsResponseSchema.parse(await secondPage.json())).toEqual({
    data: [],
    meta: { page: 2, pageSize: 20, total: 9 },
  });
});

it('账号核对、同slug的CAS请求头及严格输入校验失败都不留下业务副作用', async () => {
  const admin = await adminAccount();
  const wrongAccount = { 'X-Expected-Account': randomUUID() };
  await expectError(
    await admin.http.raw(base + '/terms', { headers: wrongAccount }),
    409,
    'CONFLICT',
  );
  await expectError(
    await save(admin.http, 'terms', 1, firstFields, { headers: wrongAccount }),
    409,
    'CONFLICT',
  );
  const invalidHeaders: Record<string, string>[] = [
    { 'Idempotency-Key': randomUUID() },
    { 'If-Match': policyEtag('terms', 1) },
    { 'If-Match': policyEtag('privacy', 1), 'Idempotency-Key': randomUUID() },
    { 'If-Match': policyEtag('terms', 1), 'Idempotency-Key': 'not-a-uuid' },
  ];
  for (const headers of invalidHeaders)
    await expectError(
      await admin.http.write(
        base + '/terms',
        { ...firstFields, reason: '核对同规则请求头' },
        'PATCH',
        headers,
      ),
      400,
      'INVALID_INPUT',
    );
  for (const body of [
    { ...firstFields, reason: '' },
    { ...firstFields, reason: '核对未知字段', expectedRevision: 1 },
    { ...firstFields, reason: '核对未知字段', contributors: [admin.id] },
    { ...firstFields, reason: '核对未知字段', status: 'approved' },
  ])
    expect((await command(admin.http, 'terms', 1, '', body, 'PATCH')).status).toBe(400);
  expect(
    (
      await command(admin.http, 'terms', 1, '/submissions', {
        reason: '核对缺少明确确认',
      })
    ).status,
  ).toBe(400);
  for (const suffix of ['/records?page=101', '/submissions?page=101'])
    expect((await admin.http.raw(base + '/terms' + suffix)).status).toBe(400);
  expect((await stack.browser().raw(publicBase + '/terms?publicationId=not-a-uuid')).status).toBe(
    400,
  );
  expect((await stack.browser().raw(publicBase + '/terms?includeHistory=true')).status).toBe(400);
  expect(await effects()).toEqual({ records: 0, submissions: 0, audits: 0, commands: 0 });
  expect((await managed(admin.http)).revision).toBe(1);
});
