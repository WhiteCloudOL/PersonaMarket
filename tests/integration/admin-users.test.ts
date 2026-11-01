import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  AdminUserResponseSchema,
  AdminUsersResponseSchema,
  AuthContextResponseSchema,
  ErrorResponseSchema,
  PublicReleaseResponseSchema,
  SubmissionResponseSchema,
} from '@personamarket/contracts';
import { createAdministrator } from '@personamarket/server';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { completePersona, verifiedCreator } from '../fixtures/creator.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeAll(async () => {
  stack = await createAuthStack();
});
afterAll(async () => {
  await stack?.close();
});

it('管理员读取不追加近期验证，游客/普通用户隔离，详情不含认证秘密', async () => {
  const admin = await stack.admin();
  const creator = await verifiedCreator(stack);
  const target = AuthContextResponseSchema.parse(
    await (await creator.http.raw('/api/v1/auth/context')).json(),
  ).data.account;
  if (!target) throw new Error('测试用户未登录');
  expect((await stack.browser().raw('/api/v1/admin/users')).status).toBe(401);
  expect((await creator.http.raw('/api/v1/admin/users')).status).toBe(403);
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET mfa_verified_at=now()-interval '11 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
    [admin.credentials.username],
  );
  const list = await admin.http.raw('/api/v1/admin/users?q=' + creator.username);
  expect(list.status).toBe(200);
  expect(list.headers.get('cache-control')).toContain('no-store');
  expect(AdminUsersResponseSchema.parse(await list.json()).data.map((row) => row.id)).toEqual([
    target.id,
  ]);
  const detail = await admin.http.raw('/api/v1/admin/users/' + target.id);
  expect(detail.status).toBe(200);
  expect(detail.headers.get('cache-control')).toContain('no-store');
  const body = await detail.json();
  const targetDetail = AdminUserResponseSchema.parse(body).data;
  expect(targetDetail.email).toBe(creator.email);
  expect(JSON.stringify(body)).not.toMatch(/passwordHash|tokenHash|encryptedSecret|recoveryCodes/);
  const adminAccount = (await admin.http.context()).data.account;
  if (!adminAccount) throw new Error('测试管理员未登录');
  const escalation = {
    role: 'admin',
    expectedSecurityVersion: targetDetail.securityVersion,
    reason: '不得通过伪造身份提权',
  };
  const targetRolePath = '/api/v1/admin/users/' + target.id + '/role';
  expect(
    (
      await creator.http.write(targetRolePath, escalation, 'PUT', {
        'Idempotency-Key': randomUUID(),
        'X-Expected-Account': adminAccount.id,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await stack.browser().write(targetRolePath, escalation, 'PUT', {
        'Idempotency-Key': randomUUID(),
      })
    ).status,
  ).toBe(401);
  const write = await admin.http.write(
    '/api/v1/admin/users/' + target.id + '/role',
    {
      role: 'moderator',
      expectedSecurityVersion: targetDetail.securityVersion,
      reason: '验证近期身份要求',
    },
    'PUT',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(write.status).toBe(403);
  expect(ErrorResponseSchema.parse(await write.json()).error.code).toBe('MFA_REQUIRED');
  const password = await admin.http.write('/api/v1/auth/reauthenticate', {
    currentPassword: admin.credentials.password,
  });
  expect(password.status).toBe(403);
  expect(ErrorResponseSchema.parse(await password.json()).error.code).toBe('MFA_REQUIRED');
});

it('未绑定MFA的管理员在本页密码确认后可操作，角色变更幂等且立即撤销旧会话', async () => {
  const username = 'manage_' + randomUUID().replaceAll('-', '').slice(0, 12);
  const credentials = {
    username,
    email: username + '@fixture.invalid',
    password: 'Administrator fixture passphrase 2026',
  };
  await createAdministrator(stack.owner, credentials);
  const admin = stack.browser();
  expect(
    (
      await admin.write('/api/v1/auth/login', {
        identifier: username,
        password: credentials.password,
      })
    ).status,
  ).toBe(200);
  const creator = await verifiedCreator(stack);
  const target = AuthContextResponseSchema.parse(
    await (await creator.http.raw('/api/v1/auth/context')).json(),
  ).data.account;
  if (!target) throw new Error('测试用户未登录');
  const original = AdminUserResponseSchema.parse(
    await (await admin.raw('/api/v1/admin/users/' + target.id)).json(),
  ).data;
  const input = {
    role: 'moderator',
    expectedSecurityVersion: original.securityVersion,
    reason: '授予经过核对的审核权限',
  };
  const headers = { 'Idempotency-Key': randomUUID() };
  const path = '/api/v1/admin/users/' + target.id + '/role';
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET created_at=now()-interval '11 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
    [username],
  );
  const expired = await admin.write(path, input, 'PUT', headers);
  expect(expired.status).toBe(403);
  expect(ErrorResponseSchema.parse(await expired.json()).error.code).toBe('REAUTH_REQUIRED');
  const cookiesBefore = new Map(admin.cookies);
  expect(
    (await admin.write('/api/v1/auth/reauthenticate', { currentPassword: credentials.password }))
      .status,
  ).toBe(200);
  expect([...admin.cookies]).not.toEqual([...cookiesBefore]);
  const changed = await admin.write(path, input, 'PUT', headers);
  expect(changed.status).toBe(200);
  const result = AdminUserResponseSchema.parse(await changed.json()).data;
  expect(result.role).toBe('moderator');
  expect(result.securityVersion).toBe(original.securityVersion + 1);
  expect(result.records).toHaveLength(1);
  expect(result.records[0]?.reason).toBe(input.reason);
  expect((await creator.http.raw('/api/v1/auth/sessions')).status).toBe(401);
  const repeated = await admin.write(path, input, 'PUT', headers);
  expect(repeated.status).toBe(200);
  expect(AdminUserResponseSchema.parse(await repeated.json()).data.records).toHaveLength(1);
  const mismatch = await admin.write(path, { ...input, role: 'user' }, 'PUT', headers);
  expect(mismatch.status).toBe(409);
  const stale = await admin.write(path, { ...input, role: 'user' }, 'PUT', {
    'Idempotency-Key': randomUUID(),
  });
  expect(stale.status).toBe(412);
  expect(ErrorResponseSchema.parse(await stale.json()).error.code).toBe('REVISION_CONFLICT');
  expect(
    (
      await creator.http.write('/api/v1/auth/login', {
        identifier: creator.username,
        password: creator.password,
      })
    ).status,
  ).toBe(200);
  expect((await creator.http.raw('/api/v1/admin/users')).status).toBe(403);
  expect((await creator.http.raw('/api/v1/admin/users/' + result.id)).status).toBe(403);
  expect(
    (
      await creator.http.write(
        path,
        {
          ...input,
          role: 'admin',
          expectedSecurityVersion: result.securityVersion,
        },
        'PUT',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(403);
});

it('真实21条用户分页无遗漏，搜索按字面匹配，非法过滤与超界输入被拒绝', async () => {
  const admin = await stack.admin();
  const prefix = 'page_' + randomUUID().replaceAll('-', '').slice(0, 10);
  const usernames = Array.from(
    { length: 21 },
    (_, index) => prefix + '_' + String(index).padStart(2, '0'),
  );
  for (const username of usernames) {
    await createAdministrator(stack.owner, {
      username,
      email: username + '@fixture.invalid',
      password: 'Pagination fixture passphrase 2026',
    });
  }
  const path = '/api/v1/admin/users?q=' + prefix + '&role=admin&status=active&sort=username';
  const firstResponse = await admin.http.raw(path);
  expect(firstResponse.status).toBe(200);
  const first = AdminUsersResponseSchema.parse(await firstResponse.json());
  expect(first.meta).toEqual({ page: 1, pageSize: 20, total: 21 });
  expect(first.data.map((row) => row.username)).toEqual(usernames.slice(0, 20));
  const secondResponse = await admin.http.raw(path + '&page=2');
  expect(secondResponse.status).toBe(200);
  const second = AdminUsersResponseSchema.parse(await secondResponse.json());
  expect(second.meta).toEqual({ page: 2, pageSize: 20, total: 21 });
  expect(second.data.map((row) => row.username)).toEqual(usernames.slice(20));
  expect(new Set([...first.data, ...second.data].map((row) => row.id)).size).toBe(21);
  for (const query of [
    'page=0',
    'page=2501',
    'pageSize=21',
    'role=owner',
    'status=deleted',
    'sort=secret',
    'actorId=' + randomUUID(),
  ]) {
    expect((await admin.http.raw('/api/v1/admin/users?' + query)).status).toBe(400);
  }
  const wildcard = await admin.http.raw('/api/v1/admin/users?q=%25');
  expect(wildcard.status).toBe(200);
  expect(AdminUsersResponseSchema.parse(await wildcard.json()).data).toEqual([]);
  expect((await admin.http.raw('/api/v1/admin/users/not-a-uuid')).status).toBe(400);
  expect((await admin.http.raw('/api/v1/admin/users/' + randomUUID())).status).toBe(404);
});

it('默认封禁只处理账号，明确范围才下架作品，恢复账号保留作品封禁和历史正文', async () => {
  const admin = await stack.admin();
  const creator = await verifiedCreator(stack);
  const persona = await completePersona(creator.http);
  const submitted = await creator.http.write(
    '/api/v1/me/personas/' + persona.id + '/releases',
    {
      version: '1.0.0',
      expectedDraftRevision: persona.revision,
      changelog: '账号与作品独立处置验证',
      confirmed: true,
    },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(submitted.status).toBe(200);
  const submission = SubmissionResponseSchema.parse(await submitted.json()).data;
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/moderation/submissions/' + submission.id + '/review',
        {
          action: 'approve',
          expectedRevision: 1,
          reason: '核对公开作品',
          selfReviewConfirmed: false,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  const publicPath = '/api/v1/personas/' + persona.id;
  const initialPublic = PublicReleaseResponseSchema.parse(
    await (await stack.browser().raw(publicPath)).json(),
  );
  const target = AuthContextResponseSchema.parse(
    await (await creator.http.raw('/api/v1/auth/context')).json(),
  ).data.account;
  if (!target) throw new Error('测试用户未登录');
  const before = AdminUserResponseSchema.parse(
    await (await admin.http.raw('/api/v1/admin/users/' + target.id)).json(),
  ).data;
  const path = '/api/v1/admin/users/' + target.id + '/status';
  const command = (
    status: 'active' | 'banned',
    expectedSecurityVersion: number,
    scope?: 'account_and_personas',
  ) =>
    admin.http.write(
      path,
      {
        status,
        expectedSecurityVersion,
        reason: '核对账号与作品的独立状态',
        ...(scope ? { scope } : {}),
      },
      'PUT',
      { 'Idempotency-Key': randomUUID() },
    );
  expect((await command('banned', before.securityVersion)).status).toBe(200);
  expect((await creator.http.raw('/api/v1/auth/sessions')).status).toBe(401);
  const publicAfterBan = await stack.browser().raw(publicPath);
  expect(publicAfterBan.status).toBe(200);
  expect(PublicReleaseResponseSchema.parse(await publicAfterBan.json()).data.snapshot).toEqual(
    initialPublic.data.snapshot,
  );
  const state = async () =>
    (
      await stack.owner.pool.query('SELECT moderation_state FROM personas WHERE id=$1', [
        persona.id,
      ])
    ).rows[0]?.moderation_state;
  expect(await state()).toBe('normal');
  expect((await command('active', before.securityVersion + 1)).status).toBe(200);
  expect((await command('banned', before.securityVersion + 2, 'account_and_personas')).status).toBe(
    200,
  );
  expect(await state()).toBe('blocked');
  expect((await stack.browser().raw(publicPath)).status).toBe(404);
  expect((await command('active', before.securityVersion + 3)).status).toBe(200);
  expect(await state()).toBe('blocked');
  expect((await stack.browser().raw(publicPath)).status).toBe(404);
  const original = await stack.owner.pool.query(
    'SELECT payload FROM persona_drafts WHERE persona_id=$1',
    [persona.id],
  );
  expect(original.rows[0]?.payload).toMatchObject({
    title: persona.draft.title,
    content: persona.draft.content,
  });
});
