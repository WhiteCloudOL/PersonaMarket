import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { mailCode, mailToken } from '../fixtures/mailpit.js';
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
  expect((await http.register(credentials, stack.tick)).status).toBe(200);
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
      (
        await stack
          .browser()
          .write('/api/v1/auth/register', { ...invalid, password, code: '000000' })
      ).status,
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
  const old = await mailCode(first, '换绑邮箱', stack.tick);
  expect(
    (
      await http.write('/api/v1/me/security/email', {
        currentPassword: credentials.password,
        email: second,
      })
    ).status,
  ).toBe(200);
  const token = await mailCode(second, '换绑邮箱', stack.tick);
  expect((await http.context()).data.account?.email).toBe(credentials.email);
  const confirm = (email: string, code: string) =>
    http.write('/api/v1/me/security/email/confirm', {
      email,
      code,
      currentPassword: credentials.password,
    });
  expect((await confirm(first, old)).status).toBe(400);
  expect(
    (
      await stack.browser().write('/api/v1/me/security/email/confirm', {
        email: second,
        code: token,
        currentPassword: credentials.password,
      })
    ).status,
  ).toBe(401);
  expect((await confirm(second, token)).status).toBe(200);
  expect((await confirm(second, token)).status).toBe(401);
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
  const first = await mailCode(target, '换绑邮箱', stack.tick);
  await b.http.write('/api/v1/me/security/email', {
    currentPassword: b.credentials.password,
    email: target,
  });
  const second = await mailCode(target, '换绑邮箱', stack.tick, [first]);
  expect(second.length).toBe(6);
  const statuses = (
    await Promise.all([
      a.http.write('/api/v1/me/security/email/confirm', {
        email: target,
        code: first,
        currentPassword: a.credentials.password,
      }),
      b.http.write('/api/v1/me/security/email/confirm', {
        email: target,
        code: second,
        currentPassword: b.credentials.password,
      }),
    ])
  )
    .map((response) => response.status)
    .sort();
  expect(statuses).toEqual([200, 409]);
  expect(
    (await stack.owner.pool.query('SELECT id FROM users WHERE email=$1', [target])).rowCount,
  ).toBe(1);
  expect(
    (await stack.owner.pool.query('SELECT code_hash FROM email_verification_codes')).rowCount,
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
