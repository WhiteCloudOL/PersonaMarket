import { randomUUID } from 'node:crypto';
import { createDatabase } from '@personamarket/database';
import { createAdministrator } from '@personamarket/server';
import { beforeEach, afterEach, it, expect } from 'vitest';
import {
  AdminUserResponseSchema,
  AdminUsersResponseSchema,
  DeactivationResponseSchema,
  ErrorResponseSchema,
  PublicReleaseResponseSchema,
  SubmissionResponseSchema,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { completePersona, verifiedCreator } from '../fixtures/creator.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});

async function application() {
  const creator = await verifiedCreator(stack);
  const account = (await creator.http.context()).data.account;
  if (!account) throw new Error('测试用户未登录');
  expect(
    (
      await creator.http.write('/api/v1/me/security/deactivation', {
        currentPassword: creator.password,
        confirmation: '申请停用',
        reason: '暂时停止使用账号，保留原申请理由',
      })
    ).status,
  ).toBe(200);
  const request = DeactivationResponseSchema.parse(
    await (await creator.http.raw('/api/v1/me/security/deactivation')).json(),
  ).data.request;
  if (!request) throw new Error('停用申请没有保存');
  return { creator, account, request };
}

it('批准指定停用申请原子撤销会话，保留公开作品和不可变正文，普通恢复不能重新启用', async () => {
  const admin = await stack.admin();
  const creator = await verifiedCreator(stack);
  const persona = await completePersona(creator.http);
  const submissionResponse = await creator.http.write(
    '/api/v1/me/personas/' + persona.id + '/releases',
    {
      version: '1.0.0',
      expectedDraftRevision: persona.revision,
      changelog: '停用与公开内容独立验证',
      confirmed: true,
    },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(submissionResponse.status).toBe(200);
  const submission = SubmissionResponseSchema.parse(await submissionResponse.json()).data;
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/moderation/submissions/' + submission.id + '/review',
        {
          action: 'approve',
          expectedRevision: submission.revision,
          reason: '核对停用测试作品',
          selfReviewConfirmed: false,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  const publicPath = '/api/v1/personas/' + persona.id;
  const before = PublicReleaseResponseSchema.parse(
    await (await stack.browser().raw(publicPath)).json(),
  ).data;
  const account = (await creator.http.context()).data.account;
  if (!account) throw new Error('测试用户未登录');
  expect(
    (
      await creator.http.write('/api/v1/me/security/deactivation', {
        currentPassword: creator.password,
        confirmation: '申请停用',
        reason: '账号暂停使用，作品仍按其状态展示',
      })
    ).status,
  ).toBe(200);
  const application = DeactivationResponseSchema.parse(
    await (await creator.http.raw('/api/v1/me/security/deactivation')).json(),
  ).data.request;
  if (!application) throw new Error('停用申请没有保存');
  const detail = AdminUserResponseSchema.parse(
    await (await admin.http.raw('/api/v1/admin/users/' + account.id)).json(),
  ).data;
  const response = await admin.http.write(
    '/api/v1/admin/users/' + account.id + '/deactivation-requests/' + application.id + '/review',
    {
      decision: 'approve',
      expectedSecurityVersion: detail.securityVersion,
      reason: '已核对本人申请，仅停用账号',
    },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(response.status).toBe(200);
  const result = AdminUserResponseSchema.parse(await response.json()).data;
  expect(result.status).toBe('deactivated');
  expect(result.securityVersion).toBe(detail.securityVersion + 1);
  expect(result.activeSessionCount).toBe(0);
  expect((await creator.http.raw('/api/v1/auth/sessions')).status).toBe(401);
  const publicAfter = await stack.browser().raw(publicPath);
  expect(publicAfter.status).toBe(200);
  expect(PublicReleaseResponseSchema.parse(await publicAfter.json()).data.snapshot).toEqual(
    before.snapshot,
  );
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/users/' + account.id + '/status',
        {
          status: 'active',
          expectedSecurityVersion: result.securityVersion,
          reason: '普通恢复不得重新启用已停用账号',
        },
        'PUT',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await stack.owner.pool.query('SELECT status FROM deactivation_requests WHERE id=$1', [
        application.id,
      ])
    ).rows[0]?.status,
  ).toBe('approved');
});

it('驳回保留账号会话和原申请，同键不重复记录，异键与不同内容冲突，用户可重新申请', async () => {
  const admin = await stack.admin();
  const { creator, account, request } = await application();
  const before = AdminUserResponseSchema.parse(
    await (await admin.http.raw('/api/v1/admin/users/' + account.id)).json(),
  ).data;
  const path =
    '/api/v1/admin/users/' + account.id + '/deactivation-requests/' + request.id + '/review';
  const input = {
    decision: 'reject',
    expectedSecurityVersion: before.securityVersion,
    reason: '申请信息需要本人进一步核对',
  };
  const headers = { 'Idempotency-Key': randomUUID() };
  const response = await admin.http.write(path, input, 'POST', headers);
  expect(response.status).toBe(200);
  const after = AdminUserResponseSchema.parse(await response.json()).data;
  expect(after.status).toBe('active');
  expect(after.securityVersion).toBe(before.securityVersion);
  expect(after.activeSessionCount).toBe(before.activeSessionCount);
  expect((await creator.http.raw('/api/v1/auth/sessions')).status).toBe(200);
  const own = DeactivationResponseSchema.parse(
    await (await creator.http.raw('/api/v1/me/security/deactivation')).json(),
  ).data.request;
  expect(own).toMatchObject({ id: request.id, status: 'rejected', reason: request.reason });
  expect((await admin.http.write(path, input, 'POST', headers)).status).toBe(200);
  expect(
    (await admin.http.write(path, { ...input, reason: '同键不得绑定另一决定' }, 'POST', headers))
      .status,
  ).toBe(409);
  expect(
    (await admin.http.write(path, input, 'POST', { 'Idempotency-Key': randomUUID() })).status,
  ).toBe(409);
  expect(
    (
      await stack.owner.pool.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM deactivation_decisions WHERE application_id=$1',
        [request.id],
      )
    ).rows[0]?.count,
  ).toBe(1);
  expect(
    (
      await creator.http.write('/api/v1/me/security/deactivation', {
        currentPassword: creator.password,
        confirmation: '申请停用',
        reason: '核对后重新申请',
      })
    ).status,
  ).toBe(200);
});

it('用户撤回后不能再批准，普通用户和游客不能处理申请，其他账号申请不可混用', async () => {
  const admin = await stack.admin();
  const { creator, account, request } = await application();
  const other = await verifiedCreator(stack);
  const otherAccount = (await other.http.context()).data.account;
  if (!otherAccount) throw new Error('参照用户未登录');
  const otherDetail = AdminUserResponseSchema.parse(
    await (await admin.http.raw('/api/v1/admin/users/' + otherAccount.id)).json(),
  ).data;
  const before = AdminUserResponseSchema.parse(
    await (await admin.http.raw('/api/v1/admin/users/' + account.id)).json(),
  ).data;
  const path =
    '/api/v1/admin/users/' + account.id + '/deactivation-requests/' + request.id + '/review';
  const input = {
    decision: 'approve',
    expectedSecurityVersion: before.securityVersion,
    reason: '核对申请与归属',
  };
  expect(
    (await stack.browser().write(path, input, 'POST', { 'Idempotency-Key': randomUUID() })).status,
  ).toBe(401);
  expect(
    (await creator.http.write(path, input, 'POST', { 'Idempotency-Key': randomUUID() })).status,
  ).toBe(403);
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/users/' +
          otherAccount.id +
          '/deactivation-requests/' +
          request.id +
          '/review',
        {
          ...input,
          expectedSecurityVersion: otherDetail.securityVersion,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(404);
  expect(
    (await creator.http.write('/api/v1/me/security/deactivation', undefined, 'DELETE')).status,
  ).toBe(200);
  const response = await admin.http.write(path, input, 'POST', { 'Idempotency-Key': randomUUID() });
  expect(response.status).toBe(409);
  expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe('CONFLICT');
  expect((await creator.http.raw('/api/v1/auth/sessions')).status).toBe(200);
  expect(
    (
      await stack.owner.pool.query('SELECT status FROM deactivation_requests WHERE id=$1', [
        request.id,
      ])
    ).rows[0]?.status,
  ).toBe('withdrawn');
});

it('数据库保护申请原文和终态，决定必须匹配申请，owner和app都不能改写处理记录', async () => {
  const admin = await stack.admin();
  const account = (await admin.http.context()).data.account;
  if (!account) throw new Error('管理员未登录');
  const application = await stack.owner.pool.query<{ id: string }>(
    'INSERT INTO deactivation_requests(user_id,reason) VALUES($1,$2) RETURNING id',
    [account.id, '数据库约束的受控原始申请'],
  );
  const id = application.rows[0]?.id;
  if (!id) throw new Error('原始申请未保存');
  await expect(
    stack.owner.pool.query('UPDATE deactivation_requests SET reason=$2 WHERE id=$1', [
      id,
      '不得改写',
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    stack.owner.pool.query("UPDATE deactivation_requests SET status='approved' WHERE id=$1", [id]),
  ).rejects.toMatchObject({ code: '23514' });
  const state = AdminUserResponseSchema.parse(
    await (await admin.http.raw('/api/v1/admin/users/' + account.id)).json(),
  ).data;
  expect(state.pendingDeactivation).toBe(true);
  expect(state.deactivationRequests[0]).toMatchObject({
    id,
    reason: '数据库约束的受控原始申请',
    status: 'pending',
    decision: null,
  });
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/users/' + account.id + '/deactivation-requests/' + id + '/review',
        {
          decision: 'reject',
          expectedSecurityVersion: state.securityVersion,
          reason: '核对终态与追加式记录',
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  const result = await stack.owner.pool.query<{ id: string }>(
    'SELECT id FROM deactivation_decisions WHERE application_id=$1',
    [id],
  );
  const decisionId = result.rows[0]?.id;
  if (!decisionId) throw new Error('决定未保存');
  const app = createDatabase(stack.env.DATABASE_URL);
  try {
    for (const statement of [
      "UPDATE deactivation_decisions SET reason='不得改写' WHERE id=$1",
      'DELETE FROM deactivation_decisions WHERE id=$1',
    ]) {
      await expect(stack.owner.pool.query(statement, [decisionId])).rejects.toMatchObject({
        code: '23514',
      });
      await expect(app.pool.query(statement, [decisionId])).rejects.toMatchObject({
        code: '42501',
      });
    }
    await expect(
      stack.owner.pool.query("UPDATE deactivation_requests SET status='pending' WHERE id=$1", [id]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      stack.owner.pool.query('DELETE FROM deactivation_requests WHERE id=$1', [id]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      app.pool.query('DELETE FROM deactivation_requests WHERE id=$1', [id]),
    ).rejects.toMatchObject({ code: '42501' });
  } finally {
    await app.close();
  }
});

it('最后管理员不能自批停用，增加第二位管理员后可重试原操作并只保存一个决定', async () => {
  const admin = await stack.admin();
  const account = (await admin.http.context()).data.account;
  if (!account) throw new Error('管理员未登录');
  expect(
    (
      await admin.http.write('/api/v1/me/security/deactivation', {
        currentPassword: admin.credentials.password,
        confirmation: '申请停用',
        reason: '管理员本人申请停用',
      })
    ).status,
  ).toBe(200);
  const request = DeactivationResponseSchema.parse(
    await (await admin.http.raw('/api/v1/me/security/deactivation')).json(),
  ).data.request;
  if (!request) throw new Error('申请不存在');
  const before = AdminUserResponseSchema.parse(
    await (await admin.http.raw('/api/v1/admin/users/' + account.id)).json(),
  ).data;
  const path =
    '/api/v1/admin/users/' + account.id + '/deactivation-requests/' + request.id + '/review';
  const input = {
    decision: 'approve',
    expectedSecurityVersion: before.securityVersion,
    reason: '必须保留有效管理员',
  };
  const headers = { 'Idempotency-Key': randomUUID() };
  const denied = await admin.http.write(path, input, 'POST', headers);
  expect(denied.status).toBe(409);
  expect(ErrorResponseSchema.parse(await denied.json()).error.code).toBe('CONFLICT');
  expect((await admin.http.raw('/api/v1/auth/sessions')).status).toBe(200);
  expect(
    (
      await stack.owner.pool.query('SELECT status FROM deactivation_requests WHERE id=$1', [
        request.id,
      ])
    ).rows[0]?.status,
  ).toBe('pending');
  const username = 'remaining_' + randomUUID().replaceAll('-', '').slice(0, 12);
  await createAdministrator(stack.owner, {
    username,
    email: username + '@fixture.invalid',
    password: 'Remaining administrator fixture 2026',
  });
  const response = await admin.http.write(path, input, 'POST', headers);
  expect(response.status).toBe(200);
  expect(AdminUserResponseSchema.parse(await response.json()).data.status).toBe('deactivated');
  expect((await admin.http.raw('/api/v1/auth/sessions')).status).toBe(401);
  expect(
    (
      await stack.owner.pool.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM users WHERE role='admin' AND status='active'",
      )
    ).rows[0]?.count,
  ).toBe(1);
  expect(
    (
      await stack.owner.pool.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM deactivation_decisions WHERE application_id=$1',
        [request.id],
      )
    ).rows[0]?.count,
  ).toBe(1);
});

it('普通浏览无需近期验证，绑定MFA不能用密码绕过，未绑定管理员可确认密码后人工重试', async () => {
  const bound = await stack.admin();
  const { creator, account, request } = await application();
  const before = AdminUserResponseSchema.parse(
    await (await bound.http.raw('/api/v1/admin/users/' + account.id)).json(),
  ).data;
  const path =
    '/api/v1/admin/users/' + account.id + '/deactivation-requests/' + request.id + '/review';
  const input = {
    decision: 'reject',
    expectedSecurityVersion: before.securityVersion,
    reason: '确认真实近期身份再处理',
  };
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET mfa_verified_at=now()-interval '11 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
    [bound.credentials.username],
  );
  expect((await bound.http.raw('/api/v1/admin/users/' + account.id)).status).toBe(200);
  const needsMfa = await bound.http.write(path, input, 'POST', { 'Idempotency-Key': randomUUID() });
  expect(needsMfa.status).toBe(403);
  expect(ErrorResponseSchema.parse(await needsMfa.json()).error.code).toBe('MFA_REQUIRED');
  const cannotBypass = await bound.http.write('/api/v1/auth/reauthenticate', {
    currentPassword: bound.credentials.password,
  });
  expect(cannotBypass.status).toBe(403);
  expect(ErrorResponseSchema.parse(await cannotBypass.json()).error.code).toBe('MFA_REQUIRED');
  const username = 'voluntary_' + randomUUID().replaceAll('-', '').slice(0, 12);
  const password = 'Voluntary administrator fixture 2026';
  await createAdministrator(stack.owner, {
    username,
    email: username + '@fixture.invalid',
    password,
  });
  const unbound = stack.browser();
  expect(
    (await unbound.write('/api/v1/auth/login', { identifier: username, password })).status,
  ).toBe(200);
  const unboundId = (await unbound.context()).data.account?.id;
  if (!unboundId) throw new Error('未绑定管理员没有登录');
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET created_at=now()-interval '11 minutes' WHERE user_id=$1",
    [unboundId],
  );
  const headers = { 'Idempotency-Key': randomUUID() };
  const expired = await unbound.write(path, input, 'POST', headers);
  expect(expired.status).toBe(403);
  expect(ErrorResponseSchema.parse(await expired.json()).error.code).toBe('REAUTH_REQUIRED');
  const cookies = new Map(unbound.cookies);
  expect(
    (await unbound.write('/api/v1/auth/reauthenticate', { currentPassword: password })).status,
  ).toBe(200);
  expect([...unbound.cookies]).not.toEqual([...cookies]);
  expect(
    (
      await stack.owner.pool.query('SELECT status FROM deactivation_requests WHERE id=$1', [
        request.id,
      ])
    ).rows[0]?.status,
  ).toBe('pending');
  expect((await unbound.write(path, input, 'POST', headers)).status).toBe(200);
  expect((await creator.http.raw('/api/v1/auth/sessions')).status).toBe(200);
});

it('待处理筛选真实生效，旧安全版本不能处理申请，刷新后按新的明确版本提交', async () => {
  const admin = await stack.admin();
  const { account, creator, request } = await application();
  const listPath = '/api/v1/admin/users?q=' + creator.username + '&deactivation=pending';
  const pending = AdminUsersResponseSchema.parse(await (await admin.http.raw(listPath)).json());
  expect(pending.data.map((row) => row.id)).toEqual([account.id]);
  expect(pending.data[0]?.pendingDeactivation).toBe(true);
  const before = AdminUserResponseSchema.parse(
    await (await admin.http.raw('/api/v1/admin/users/' + account.id)).json(),
  ).data;
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/users/' + account.id + '/sessions',
        {
          expectedSecurityVersion: before.securityVersion,
          reason: '另一管理请求撤销了会话',
        },
        'PUT',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  const path =
    '/api/v1/admin/users/' + account.id + '/deactivation-requests/' + request.id + '/review';
  const input = {
    decision: 'reject',
    expectedSecurityVersion: before.securityVersion,
    reason: '必须核对最新账号状态',
  };
  const stale = await admin.http.write(path, input, 'POST', { 'Idempotency-Key': randomUUID() });
  expect(stale.status).toBe(412);
  expect(ErrorResponseSchema.parse(await stale.json()).error.code).toBe('REVISION_CONFLICT');
  expect(
    (
      await stack.owner.pool.query('SELECT status FROM deactivation_requests WHERE id=$1', [
        request.id,
      ])
    ).rows[0]?.status,
  ).toBe('pending');
  const current = AdminUserResponseSchema.parse(
    await (await admin.http.raw('/api/v1/admin/users/' + account.id)).json(),
  ).data;
  expect(
    (
      await admin.http.write(
        path,
        { ...input, expectedSecurityVersion: current.securityVersion },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  expect(
    AdminUsersResponseSchema.parse(await (await admin.http.raw(listPath)).json()).data,
  ).toEqual([]);
});

it('并发撤回与批准只有一个决定生效，账号与申请状态保持一致', async () => {
  const admin = await stack.admin();
  const { creator, account, request } = await application();
  const state = AdminUserResponseSchema.parse(
    await (await admin.http.raw('/api/v1/admin/users/' + account.id)).json(),
  ).data;
  const [withdrawn, reviewed] = await Promise.all([
    creator.http.write('/api/v1/me/security/deactivation', undefined, 'DELETE'),
    admin.http.write(
      '/api/v1/admin/users/' + account.id + '/deactivation-requests/' + request.id + '/review',
      {
        decision: 'approve',
        expectedSecurityVersion: state.securityVersion,
        reason: '核对并发撤回与批准',
      },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    ),
  ]);
  expect([
    [200, 409],
    [401, 200],
  ]).toContainEqual([withdrawn.status, reviewed.status]);
  const row = (
    await stack.owner.pool.query<{
      application_status: string;
      account_status: string;
      decisions: number;
    }>(
      'SELECT r.status AS application_status,u.status AS account_status,(SELECT count(*)::int FROM deactivation_decisions d WHERE d.application_id=r.id) AS decisions FROM deactivation_requests r JOIN users u ON u.id=r.user_id WHERE r.id=$1',
      [request.id],
    )
  ).rows[0];
  if (reviewed.status === 200)
    expect(row).toEqual({
      application_status: 'approved',
      account_status: 'deactivated',
      decisions: 1,
    });
  else
    expect(row).toEqual({
      application_status: 'withdrawn',
      account_status: 'active',
      decisions: 0,
    });
});
