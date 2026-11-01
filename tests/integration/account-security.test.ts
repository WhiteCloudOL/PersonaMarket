import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { mailToken } from '../fixtures/mailpit.js';
let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});
async function account(password = 'A fixture account passphrase 2026') {
  const username = 'secure_' + randomUUID().replaceAll('-', '').slice(0, 12);
  const credentials = { username, email: username + '@fixture.invalid', password };
  const http = stack.browser();
  expect((await http.write('/api/v1/auth/register', credentials)).status).toBe(200);
  const token = await mailToken(credentials.email, 'verify-email', stack.tick);
  expect((await http.write('/api/v1/auth/verify-email', { token })).status).toBe(200);
  expect((await http.write('/api/v1/auth/login', { identifier: username, password })).status).toBe(
    200,
  );
  return { http, credentials };
}
it('12–64 新密码边界、常见口令拒绝、当前密码校验与全部旧会话/重置链接撤销', async () => {
  const { http, credentials } = await account('DuckSafe2026');
  const invalid = {
    username: 'invalid_' + randomUUID().slice(0, 8),
    email: 'invalid-' + randomUUID() + '@fixture.invalid',
  };
  for (const password of ['shortpass11', 'x'.repeat(65), 'passwordpassword'])
    expect(
      (await stack.browser().write('/api/v1/auth/register', { ...invalid, password })).status,
    ).toBe(400);
  const other = stack.browser();
  expect(
    (
      await other.write('/api/v1/auth/login', {
        identifier: credentials.username,
        password: credentials.password,
      })
    ).status,
  ).toBe(200);
  expect(
    (await http.write('/api/v1/auth/forgot-password', { email: credentials.email })).status,
  ).toBe(200);
  const oldReset = await mailToken(credentials.email, 'reset-password', stack.tick);
  expect(
    (
      await http.write('/api/v1/me/security/password', {
        currentPassword: 'incorrect',
        newPassword: 'ChangedDuck!',
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await http.write('/api/v1/me/security/password', {
        currentPassword: credentials.password,
        newPassword: 'passwordpassword',
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await http.write('/api/v1/me/security/password', {
        currentPassword: credentials.password,
        newPassword: 'ChangedDuck!',
      })
    ).status,
  ).toBe(200);
  expect((await http.context()).data.assurance).toBe('anonymous');
  expect((await other.context()).data.assurance).toBe('anonymous');
  expect(
    (
      await http.write('/api/v1/auth/reset-password', {
        token: oldReset,
        password: 'Another unique long password',
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await http.write('/api/v1/auth/login', {
        identifier: credentials.username,
        password: credentials.password,
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await http.write('/api/v1/auth/login', {
        identifier: credentials.username,
        password: 'ChangedDuck!',
      })
    ).status,
  ).toBe(200);
});
it('新邮箱目标与用途绑定、重发失效、单次确认，确认前后身份和会话正确', async () => {
  const { http, credentials } = await account();
  const first = 'first-' + randomUUID() + '@fixture.invalid';
  const second = 'second-' + randomUUID() + '@fixture.invalid';
  expect(
    (
      await http.write('/api/v1/me/security/email', {
        currentPassword: credentials.password,
        email: first,
      })
    ).status,
  ).toBe(200);
  const old = await mailToken(first, 'change-email', stack.tick);
  expect(
    (
      await http.write('/api/v1/me/security/email', {
        currentPassword: credentials.password,
        email: second,
      })
    ).status,
  ).toBe(200);
  const token = await mailToken(second, 'change-email', stack.tick);
  expect((await http.context()).data.account?.email).toBe(credentials.email);
  const confirmation = stack.browser();
  expect(
    (await confirmation.write('/api/v1/auth/confirm-email-change', { token: old })).status,
  ).toBe(400);
  expect((await confirmation.write('/api/v1/auth/verify-email', { token })).status).toBe(400);
  expect((await confirmation.write('/api/v1/auth/confirm-email-change', { token })).status).toBe(
    200,
  );
  expect((await confirmation.write('/api/v1/auth/confirm-email-change', { token })).status).toBe(
    400,
  );
  expect((await http.context()).data.assurance).toBe('anonymous');
  expect(
    (await http.write('/api/v1/auth/login', { identifier: second, password: credentials.password }))
      .status,
  ).toBe(200);
  expect((await http.context()).data.account?.emailVerified).toBe(true);
  expect((await http.context()).data.account?.username).toBe(credentials.username);
});
it('两人并发确认同一邮箱仅一人成功，失败消费回滚且保留原邮箱', async () => {
  const a = await account();
  const b = await account();
  const target = 'shared-' + randomUUID() + '@fixture.invalid';
  await a.http.write('/api/v1/me/security/email', {
    currentPassword: a.credentials.password,
    email: target,
  });
  const first = await mailToken(target, 'change-email', stack.tick);
  await b.http.write('/api/v1/me/security/email', {
    currentPassword: b.credentials.password,
    email: target,
  });
  const second = await mailToken(target, 'change-email', stack.tick, first);
  expect(second.length).toBe(43);
  const statuses = (
    await Promise.all([
      stack.browser().write('/api/v1/auth/confirm-email-change', { token: first }),
      stack.browser().write('/api/v1/auth/confirm-email-change', { token: second }),
    ])
  )
    .map((response) => response.status)
    .sort();
  expect(statuses).toEqual([200, 409]);
  expect(
    (await stack.owner.pool.query('SELECT id FROM users WHERE email=$1', [target])).rowCount,
  ).toBe(1);
  expect(
    (
      await stack.owner.pool.query(
        "SELECT token_hash FROM auth_tokens WHERE purpose='email_change' AND consumed_at IS NULL",
      )
    ).rowCount,
  ).toBe(1);
});
it('停用申请只属于本人，重复申请冲突，撤回幂等且账号保持可用；过期 MFA 拒绝安全写入', async () => {
  const a = await account();
  const b = await account();
  expect(
    (
      await a.http.write('/api/v1/me/security/deactivation', {
        currentPassword: a.credentials.password,
        confirmation: 'wrong',
        reason: '测试申请',
      })
    ).status,
  ).toBe(400);
  const request = {
    currentPassword: a.credentials.password,
    confirmation: '申请停用',
    reason: '暂停使用，之后再回来',
  };
  expect((await a.http.write('/api/v1/me/security/deactivation', request)).status).toBe(200);
  expect((await a.http.write('/api/v1/me/security/deactivation', request)).status).toBe(409);
  expect((await a.http.context()).data.account?.status).toBe('active');
  const { DeactivationResponseSchema } = await import('@personamarket/contracts');
  expect(
    DeactivationResponseSchema.parse(
      await (await b.http.raw('/api/v1/me/security/deactivation')).json(),
    ).data.request,
  ).toBeNull();
  expect((await a.http.write('/api/v1/me/security/deactivation', undefined, 'DELETE')).status).toBe(
    200,
  );
  expect((await a.http.write('/api/v1/me/security/deactivation', undefined, 'DELETE')).status).toBe(
    200,
  );
  expect(
    DeactivationResponseSchema.parse(
      await (await a.http.raw('/api/v1/me/security/deactivation')).json(),
    ).data.request?.status,
  ).toBe('withdrawn');
  const { http, credentials } = await stack.admin();
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET created_at=now()-interval '20 minutes',mfa_verified_at=now()-interval '11 minutes' WHERE user_id=$1",
    [(await http.context()).data.account?.id],
  );
  expect(
    (
      await http.write('/api/v1/me/security/password', {
        currentPassword: credentials.password,
        newPassword: 'Another unique admin password',
      })
    ).status,
  ).toBe(403);
});
