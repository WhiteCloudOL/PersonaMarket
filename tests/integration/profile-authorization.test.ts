import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  AdminUserResponseSchema,
  ErrorResponseSchema,
  ProfileSubmissionResponseSchema,
  PublicCreatorResponseSchema,
} from '@personamarket/contracts';
import { createTotp, openSecret } from '@personamarket/server';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator } from '../fixtures/creator.js';
import { mailToken } from '../fixtures/mailpit.js';
import type { AuthHttp } from '../fixtures/auth-http.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});
const nonce = () => ({ 'Idempotency-Key': randomUUID() });
const route = '/api/v1/me/profile';
const content = {
  displayName: '资料权限验证',
  bio: '这是本人私有草稿',
  avatarAssetId: null,
  links: [],
};
async function prepare(http: AuthHttp) {
  expect((await http.write(route, { content, expectedRevision: 0 }, 'PUT')).status).toBe(200);
  const response = await http.write(
    route + '/submissions',
    { expectedDraftRevision: 1, confirmed: true },
    'POST',
    nonce(),
  );
  expect(response.status).toBe(200);
  return ProfileSubmissionResponseSchema.parse(await response.json()).data;
}

it('未验证邮箱可以保存私有资料，不能提交公开快照，验证后才可提交', async () => {
  const username = 'private_' + randomUUID().replaceAll('-', '').slice(0, 12),
    email = username + '@fixture.invalid',
    password = 'Unverified profile fixture passphrase 2026',
    http = stack.browser();
  expect((await http.write('/api/v1/auth/register', { username, email, password })).status).toBe(
    200,
  );
  expect((await http.write('/api/v1/auth/login', { identifier: username, password })).status).toBe(
    200,
  );
  expect((await http.write(route, { content, expectedRevision: 0 }, 'PUT')).status).toBe(200);
  expect(
    (
      await http.write(
        route + '/submissions',
        { expectedDraftRevision: 1, confirmed: true },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(403);
  const fallback = PublicCreatorResponseSchema.parse(
    await (await stack.browser().raw('/api/v1/users/' + username)).json(),
  ).data;
  expect(fallback.displayName).toBe(username);
  expect(fallback.bio).toBe('');
  expect(fallback.approvedRevisionId).toBeNull();
  expect(
    (
      await http.write('/api/v1/auth/verify-email', {
        token: await mailToken(email, 'verify-email', stack.tick),
      })
    ).status,
  ).toBe(200);
  expect((await http.write('/api/v1/auth/login', { identifier: username, password })).status).toBe(
    200,
  );
  expect(
    (
      await http.write(
        route + '/submissions',
        { expectedDraftRevision: 1, confirmed: true },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(200);
});

it('管理员自审要求明确理由和实际近期MFA，幂等重放也不能绕过过期验证或改用密码', async () => {
  const admin = await stack.admin(),
    submission = await prepare(admin.http),
    endpoint = '/api/v1/admin/profiles/submissions/' + submission.id + '/review';
  expect(
    (
      await admin.http.write(
        endpoint,
        {
          decision: 'approve',
          expectedRevision: 1,
          reason: '本人资料',
          selfReviewConfirmed: false,
        },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await admin.http.write(
        endpoint,
        { decision: 'approve', expectedRevision: 1, reason: '', selfReviewConfirmed: true },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(403);
  const key = nonce(),
    command = {
      decision: 'approve',
      expectedRevision: 1,
      reason: '本人资料已逐项核验，确认自审',
      selfReviewConfirmed: true,
    };
  expect((await admin.http.write(endpoint, command, 'POST', key)).status).toBe(200);
  const identity = (await admin.http.context()).data.account;
  if (!identity) throw new Error('Missing controlled administrator');
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET mfa_verified_at=clock_timestamp()-interval '11 minutes' WHERE user_id=$1 AND revoked_at IS NULL",
    [identity.id],
  );
  const denied = await admin.http.write(endpoint, command, 'POST', key);
  expect(denied.status).toBe(403);
  expect(ErrorResponseSchema.parse(await denied.json()).error.code).toBe('MFA_REQUIRED');
  expect((await admin.http.raw('/api/v1/admin/profiles/submissions/' + submission.id)).status).toBe(
    200,
  );
  expect(
    (
      await admin.http.write('/api/v1/auth/reauthenticate', {
        currentPassword: admin.credentials.password,
      })
    ).status,
  ).toBe(403);
  const mfa = await stack.owner.pool.query<{ encrypted_secret: string }>(
      'SELECT encrypted_secret FROM user_mfa WHERE user_id=$1',
      [identity.id],
    ),
    encrypted = mfa.rows[0]?.encrypted_secret;
  if (!encrypted) throw new Error('Missing controlled MFA fixture');
  const secret = openSecret(stack.env.APP_ENCRYPTION_KEY, 'mfa:' + identity.id, encrypted);
  expect(
    (
      await admin.http.write('/api/v1/auth/mfa/verify', {
        code: createTotp(secret, admin.credentials.username).generate({
          timestamp: Date.now() + 30000,
        }),
      })
    ).status,
  ).toBe(200);
  expect((await admin.http.write(endpoint, command, 'POST', key)).status).toBe(200);
  const records = await stack.owner.pool.query<{ amount: number }>(
    "SELECT count(*)::int AS amount FROM profile_records WHERE submission_id=$1 AND action='approve' AND self_review",
    [submission.id],
  );
  expect(records.rows[0]?.amount).toBe(1);
});

it('审核员可以读取队列，但不能自审或操作仅管理员可用的资料下架', async () => {
  const creator = await verifiedCreator(stack),
    admin = await stack.admin(),
    account = (await creator.http.context()).data.account;
  if (!account) throw new Error('Missing controlled creator');
  const user = AdminUserResponseSchema.parse(
    await (await admin.http.raw('/api/v1/admin/users/' + account.id)).json(),
  ).data;
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/users/' + account.id + '/role',
        {
          role: 'moderator',
          expectedSecurityVersion: user.securityVersion,
          reason: '隔离测试赋予审核员角色',
        },
        'PUT',
        nonce(),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await creator.http.write('/api/v1/auth/login', {
        identifier: creator.username,
        password: creator.password,
      })
    ).status,
  ).toBe(200);
  expect((await creator.http.raw('/api/v1/admin/profiles/submissions')).status).toBe(200);
  const submission = await prepare(creator.http);
  const endpoint = '/api/v1/admin/profiles/submissions/' + submission.id + '/review';
  expect(
    (
      await creator.http.write(
        endpoint,
        {
          decision: 'approve',
          expectedRevision: 1,
          reason: '审核员不能自审',
          selfReviewConfirmed: true,
        },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await admin.http.write(
        endpoint,
        {
          decision: 'approve',
          expectedRevision: 1,
          reason: '管理员审核他人资料',
          selfReviewConfirmed: false,
        },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await creator.http.write(
        '/api/v1/admin/profiles/' + account.id + '/visibility',
        {
          hidden: true,
          expectedRevision: 2,
          reason: '审核员不能操作管理状态',
          selfReviewConfirmed: true,
        },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(403);
});
