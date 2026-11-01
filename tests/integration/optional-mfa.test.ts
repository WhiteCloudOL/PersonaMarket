import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AccountSettingsResponseSchema, ErrorResponseSchema } from '@personamarket/contracts';
import { createAdministrator } from '@personamarket/server';
import { createAuthStack } from '../fixtures/auth-stack.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeAll(async () => {
  stack = await createAuthStack();
});
afterAll(async () => {
  await stack?.close();
});

it('管理员可不绑定 MFA，过期的高危操作要求密码确认且旋转会话，已绑定 MFA 不能走密码旁路', async () => {
  const username = 'optional_' + randomUUID().replaceAll('-', '').slice(0, 12);
  const password = 'Optional MFA administrator passphrase 2026';
  await createAdministrator(stack.owner, {
    username,
    email: username + '@fixture.invalid',
    password,
  });
  const browser = stack.browser();
  expect(
    (await browser.write('/api/v1/auth/login', { identifier: username, password })).status,
  ).toBe(200);
  expect((await browser.context()).data.assurance).toBe('authenticated');
  expect((await browser.context()).data.mfaEnabled).toBe(false);
  expect((await browser.raw('/api/v1/admin/settings/brand')).status).toBe(200);
  const settings = AccountSettingsResponseSchema.parse(
    await (await browser.raw('/api/v1/admin/settings/accounts')).json(),
  );
  const update = () =>
    browser.write('/api/v1/admin/settings/accounts', settings.data, 'PATCH', {
      'If-Match': '"accounts-' + settings.meta.revision + '"',
    });
  const previous = await stack.owner.pool.query<{ id: string }>(
    "UPDATE auth_sessions SET created_at=now()-interval '11 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1) RETURNING id",
    [username],
  );
  const blocked = await update();
  expect(blocked.status).toBe(403);
  expect(ErrorResponseSchema.parse(await blocked.json()).error.code).toBe('REAUTH_REQUIRED');
  expect((await browser.raw('/api/v1/admin/settings/brand')).status).toBe(200);
  expect(
    (await browser.write('/api/v1/auth/reauthenticate', { currentPassword: 'incorrect-password' }))
      .status,
  ).toBe(400);
  expect(
    (await browser.write('/api/v1/auth/reauthenticate', { currentPassword: password })).status,
  ).toBe(200);
  expect((await update()).status).toBe(200);
  expect(
    (
      await stack.owner.pool.query(
        'SELECT id FROM auth_sessions WHERE id=$1 AND revoked_at IS NOT NULL',
        [previous.rows[0]?.id],
      )
    ).rowCount,
  ).toBe(1);
  expect(
    (
      await stack.owner.pool.query(
        "SELECT id FROM auth_audit_events WHERE event='auth.password_reauthenticated' AND user_id=(SELECT id FROM users WHERE username=$1)",
        [username],
      )
    ).rowCount,
  ).toBe(1);
  const enrolled = await stack.admin();
  expect(
    (
      await enrolled.http.write('/api/v1/auth/reauthenticate', {
        currentPassword: enrolled.credentials.password,
      })
    ).status,
  ).toBe(403);
  expect(
    (await stack.browser().write('/api/v1/auth/reauthenticate', { currentPassword: password }))
      .status,
  ).toBe(401);
});
