import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import {
  AccountSettingsResponseSchema,
  MailSettingsResponseSchema,
  PublicConfigResponseSchema,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { mailText } from '../fixtures/mailpit.js';
import { setTimeout as pause } from 'node:timers/promises';
let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeAll(async () => {
  stack = await createAuthStack();
});
afterAll(async () => {
  await stack?.close();
});
it('品牌写入在事务内重查管理员身份，角色撤销不能与旧权限写入竞态', async () => {
  const { http, credentials } = await stack.admin();
  await stack.admin(); // 保留另一位管理员，允许本测试撤销第一位角色。
  const original = await http.raw('/api/v1/admin/settings/brand');
  const originalBody = PublicConfigResponseSchema.parse(await original.json());
  const connection = await stack.owner.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await connection.query('BEGIN');
    await connection.query('SELECT id FROM users WHERE username=$1 FOR UPDATE', [
      credentials.username,
    ]);
    pending = http.write('/api/v1/admin/settings/brand', originalBody.data, 'PATCH', {
      'If-Match': original.headers.get('etag') ?? '',
    });
    let locked = false;
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      const activity = await stack.owner.pool.query<{ locked: boolean }>(
        "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%users%' AND pid<>pg_backend_pid()) AS locked",
      );
      if (activity.rows[0]?.locked) {
        locked = true;
        break;
      }
      await pause(20);
    }
    expect(locked).toBe(true);
    await connection.query("UPDATE users SET role='user' WHERE username=$1", [
      credentials.username,
    ]);
    await connection.query('COMMIT');
    expect((await pending).status).toBe(401);
    const after = await stack.owner.pool.query<{ revision: number }>(
      "SELECT revision FROM site_settings WHERE key='brand'",
    );
    expect(after.rows[0]?.revision).toBe(originalBody.meta.revision);
  } finally {
    await connection.query('ROLLBACK');
    connection.release();
    await pending;
  }
});
it('SMTP 密码加密、脱敏、替换清除与 ETag 并发保护，普通用户和受限会话被拒绝', async () => {
  const anonymous = stack.browser();
  expect((await anonymous.raw('/api/v1/admin/settings/mail')).status).toBe(401);
  const { http } = await stack.admin();
  let response = await http.raw('/api/v1/admin/settings/mail');
  expect(response.status).toBe(200);
  const secret = randomUUID() + randomUUID();
  const input = {
    mode: 'custom',
    host: '127.0.0.1',
    port: 11025,
    secure: false,
    from: 'no-reply@personamarket.test',
    username: 'fixture',
    password: { action: 'replace', value: secret },
  };
  const etag = response.headers.get('etag') ?? '';
  response = await http.write('/api/v1/admin/settings/mail', input, 'PATCH', { 'If-Match': etag });
  expect(response.status).toBe(200);
  const publicValue = MailSettingsResponseSchema.parse(await response.json());
  expect(publicValue.data.passwordConfigured).toBe(true);
  expect(JSON.stringify(publicValue).includes(secret)).toBe(false);
  const stored = await stack.owner.pool.query<{ value: unknown }>(
    "SELECT value FROM site_settings WHERE key='mail'",
  );
  expect(JSON.stringify(stored.rows).includes(secret)).toBe(false);
  expect(JSON.stringify(stored.rows)).toContain('v1.');
  expect(
    (await http.write('/api/v1/admin/settings/mail', input, 'PATCH', { 'If-Match': etag })).status,
  ).toBe(412);
  response = await http.write(
    '/api/v1/admin/settings/mail',
    { ...input, password: { action: 'keep' } },
    'PATCH',
    { 'If-Match': response.headers.get('etag') ?? '' },
  );
  expect(response.status).toBe(200);
  expect(MailSettingsResponseSchema.parse(await response.json()).data.passwordConfigured).toBe(
    true,
  );
  response = await http.write(
    '/api/v1/admin/settings/mail',
    { ...input, username: '', password: { action: 'clear' } },
    'PATCH',
    { 'If-Match': response.headers.get('etag') ?? '' },
  );
  expect(response.status).toBe(200);
  expect(MailSettingsResponseSchema.parse(await response.json()).data.passwordConfigured).toBe(
    false,
  );
});
it('真实 SMTP 测试只发往当前管理员，Worker 立即使用数据库配置，禁用后关闭注册', async () => {
  const { http, credentials } = await stack.admin();
  expect(
    (await http.write('/api/v1/admin/settings/mail/test', { to: 'untrusted@fixture.invalid' }))
      .status,
  ).toBe(400);
  expect((await http.write('/api/v1/admin/settings/mail/test', {})).status).toBe(200);
  expect(await mailText(credentials.email, 'SMTP 配置可正常投递')).toContain('这是一封');
  const person = {
    username: 'mail_' + randomUUID().replaceAll('-', '').slice(0, 12),
    email: 'mail-' + randomUUID() + '@fixture.invalid',
    password: 'A real registration passphrase 2026',
  };
  const browser = stack.browser();
  expect((await browser.register(person, stack.tick)).status).toBe(200);
  const settings = await http.raw('/api/v1/admin/settings/mail');
  expect(
    (
      await http.write('/api/v1/admin/settings/mail', { mode: 'disabled' }, 'PATCH', {
        'If-Match': settings.headers.get('etag') ?? '',
      })
    ).status,
  ).toBe(200);
  expect((await browser.context()).data.registrationAvailable).toBe(false);
  expect((await browser.write('/api/v1/auth/register/code', { email: person.email })).status).toBe(
    503,
  );
  const unavailable = await http.write('/api/v1/admin/settings/mail/test', {});
  expect(unavailable.status).toBe(503);
  expect(JSON.stringify(await unavailable.json())).not.toContain('SMTP_NOT_CONFIGURED');
});
it('SMTP 失败、测试限流与权威注册开关，新会话使用新的有效期', async () => {
  const { http } = await stack.admin();
  const mail = await http.raw('/api/v1/admin/settings/mail');
  expect(
    (
      await http.write('/api/v1/admin/settings/mail', { mode: 'environment' }, 'PATCH', {
        'If-Match': mail.headers.get('etag') ?? '',
      })
    ).status,
  ).toBe(200);
  const current = await http.raw('/api/v1/admin/settings/accounts');
  const parsed = AccountSettingsResponseSchema.parse(await current.json());
  const updated = await http.write(
    '/api/v1/admin/settings/accounts',
    { registrationEnabled: false, sessionTtlSeconds: 600 },
    'PATCH',
    { 'If-Match': current.headers.get('etag') ?? '' },
  );
  expect(updated.status).toBe(200);
  expect(parsed.data.registrationEnabled).toBe(true);
  expect((await stack.browser().context()).data.registrationAvailable).toBe(false);
  expect(
    (
      await http.write(
        '/api/v1/admin/settings/accounts',
        { registrationEnabled: true, sessionTtlSeconds: 600 },
        'PATCH',
        { 'If-Match': updated.headers.get('etag') ?? '' },
      )
    ).status,
  ).toBe(200);
  const browser = stack.browser();
  const username = 'ttl_' + randomUUID().replaceAll('-', '').slice(0, 12);
  const credentials = {
    username,
    email: username + '@fixture.invalid',
    password: 'A session duration passphrase 2026',
  };
  expect((await browser.register(credentials, stack.tick)).status).toBe(200);
  expect(
    (
      await browser.write('/api/v1/auth/login', {
        identifier: username,
        password: credentials.password,
      })
    ).status,
  ).toBe(200);
  const context = await browser.context();
  expect(new Date(context.data.sessionExpiresAt ?? '').getTime() - Date.now()).toBeGreaterThan(
    590000,
  );
  expect(new Date(context.data.sessionExpiresAt ?? '').getTime() - Date.now()).toBeLessThanOrEqual(
    600000,
  );
  expect((await browser.raw('/api/v1/admin/settings/mail')).status).toBe(403);
  expect((await http.write('/api/v1/admin/settings/mail/test', {})).status).toBe(200);
  expect((await http.write('/api/v1/admin/settings/mail/test', {})).status).toBe(200);
  expect((await http.write('/api/v1/admin/settings/mail/test', {})).status).toBe(200);
  expect((await http.write('/api/v1/admin/settings/mail/test', {})).status).toBe(429);
});
