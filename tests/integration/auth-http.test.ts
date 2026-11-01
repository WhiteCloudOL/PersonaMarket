import { randomBytes, randomUUID } from 'node:crypto';
import { listenHttp } from '../../scripts/http-server.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApplication } from '@personamarket/api/testing';
import {
  createDatabase,
  createTestDatabaseOwner,
  migrateDatabase,
  type Database,
} from '@personamarket/database';
import { createTestDatabase, dropTestDatabase } from '../../scripts/test-database.js';
import {
  createAdministrator,
  createLogger,
  createSystemQueue,
  createSystemWorker,
  createTotp,
  dispatchOutbox,
  MailSender,
  MailConfigurationStore,
  parseServerEnvironment,
  verifyPassword,
} from '@personamarket/server';
import { z } from 'zod';
import { AuthHttp } from '../fixtures/auth-http.js';
import { mailToken } from '../fixtures/mailpit.js';
import { testEnvironment } from '../fixtures/environment.js';

const source = process.env['TEST_DATABASE_URL'];
const applicationPassword = process.env['POSTGRES_APP_PASSWORD'];
const redis = process.env['REDIS_URL'];
if (!source || !new URL(source).pathname.endsWith('_test') || !applicationPassword || !redis)
  throw new Error('认证 HTTP 测试要求隔离数据库、真实 Redis 和应用凭据');
const administrator = createTestDatabaseOwner(source);
const name = 'pm_auth_http_' + randomUUID().replaceAll('-', '') + '_test';
const password = 'A real passphrase for local test 2026';
let owner: Database;
let workerDatabase: Database;
let app: Awaited<ReturnType<typeof createApplication>>;
let base: string;
let queue: ReturnType<typeof createSystemQueue>;
let worker: ReturnType<typeof createSystemWorker>;
let sender: MailSender;
let serverEnvironment: ReturnType<typeof parseServerEnvironment>;
const logger = createLogger('auth-integration', 'silent');

beforeAll(async () => {
  await createTestDatabase(administrator, name);
  const ownerUrl = new URL(source);
  ownerUrl.pathname = '/' + name;
  owner = createDatabase(ownerUrl.toString());
  await owner.pool.query('GRANT USAGE ON SCHEMA public TO personamarket_app');
  await owner.pool.query(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO personamarket_app',
  );
  await migrateDatabase(ownerUrl.toString());
  const appUrl = new URL(ownerUrl);
  appUrl.username = 'personamarket_app';
  appUrl.password = applicationPassword;
  const env = parseServerEnvironment({
    ...testEnvironment(appUrl.toString()),
    REDIS_URL: redis,
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '11025',
    SMTP_FROM: 'no-reply@personamarket.test',
    AUTH_REGISTRATION_ENABLED: 'true',
  });
  serverEnvironment = env;
  app = await createApplication(env);
  base = await listenHttp(app);
  workerDatabase = createDatabase(appUrl.toString());
  const mailSettings = new MailConfigurationStore(workerDatabase, env);
  sender = new MailSender(env, () => mailSettings.current());
  const queueName = 'auth-http-' + randomUUID();
  queue = createSystemQueue(redis, queueName);
  await queue.waitUntilReady();
  worker = createSystemWorker(workerDatabase, redis, queueName, logger, {
    sender,
    encryptionKey: env.APP_ENCRYPTION_KEY,
  });
  await worker.waitUntilReady();
});
afterAll(async () => {
  await worker?.close();
  await queue?.obliterate({ force: true });
  await queue?.close();
  sender?.close();
  await workerDatabase?.close();
  await app?.close();
  await owner?.close();
  await dropTestDatabase(administrator, name);
  await administrator.close();
});
const tick = () => dispatchOutbox(workerDatabase, queue, logger);
function registration() {
  const username = 'writer_' + randomUUID().replaceAll('-', '').slice(0, 12);
  return { username, email: username + '@fixture.invalid', password };
}

describe('真实邮件与认证 HTTP 闭环', () => {
  it('SMTP 故障关闭注册，生产 Cookie 使用 Secure 和 __Host 前缀', async () => {
    const env = parseServerEnvironment({
      ...serverEnvironment,
      NODE_ENV: 'production',
      PUBLIC_ORIGIN: 'https://personamarket.test',
      AUTH_REGISTRATION_ENABLED: 'true',
      SMTP_SECURE: 'false',
      SMTP_PORT: '1',
      APP_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
      STATS_HMAC_KEY: randomBytes(32).toString('hex'),
    });
    const production = await createApplication(env);
    try {
      await listenHttp(production);
      const browser = new AuthHttp(await production.getUrl(), env.PUBLIC_ORIGIN);
      expect((await browser.context()).data.registrationAvailable).toBe(false);
      const person = registration();
      expect((await browser.write('/api/v1/auth/register', person)).status).toBe(503);
      expect(
        (await owner.pool.query('SELECT id FROM users WHERE username=$1', [person.username]))
          .rowCount,
      ).toBe(0);
      await createAdministrator(owner, person);
      const response = await browser.write('/api/v1/auth/login', {
        identifier: person.username,
        password: person.password,
      });
      expect(response.status).toBe(200);
      const cookie =
        response.headers.getSetCookie().find((value) => value.startsWith('__Host-pm-session=')) ??
        '';
      for (const attribute of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/'])
        expect(cookie).toContain(attribute);
      expect(cookie).not.toContain('Domain=');
      expect((await browser.context()).data.assurance).toBe('authenticated');
      expect((await browser.raw('/api/v1/admin/settings/brand')).status).toBe(200);
    } finally {
      await production.close();
    }
  });
  it('Argon2id、注册邮件、验证、登录、会话旋转与退出', async () => {
    const person = registration();
    const browser = new AuthHttp(base);
    expect((await browser.write('/api/v1/auth/register', person)).status).toBe(200);
    const stored = await owner.pool.query<{ password_hash: string; role: string }>(
      'SELECT password_hash,role FROM users WHERE username=$1',
      [person.username],
    );
    expect(stored.rows[0]?.role).toBe('user');
    const encoded = stored.rows[0]?.password_hash ?? '';
    const fields = encoded.split('$');
    expect(fields.slice(1, 3)).toEqual(['argon2id', 'v=19']);
    expect(
      Object.fromEntries((fields[3] ?? '').split(',').map((field) => field.split('='))),
    ).toEqual({ m: '65536', t: '3', p: '1' });
    expect(await verifyPassword(encoded, password)).toBe(true);
    const token = await mailToken(person.email, 'verify-email', tick);
    const payload = await owner.pool.query<{ payload: unknown }>(
      "SELECT payload FROM outbox_events WHERE topic='auth.email'",
    );
    expect(JSON.stringify(payload.rows).includes(token)).toBe(false);
    expect((await browser.write('/api/v1/auth/verify-email', { token })).status).toBe(200);
    expect((await browser.write('/api/v1/auth/verify-email', { token })).status).toBe(400);
    expect(
      (await browser.write('/api/v1/auth/login', { identifier: person.email, password })).status,
    ).toBe(200);
    const context = await browser.context();
    expect(context.data.account?.emailVerified).toBe(true);
    expect(context.data.assurance).toBe('authenticated');
    const session = browser.cookies.get('pm-session');
    const logged = await browser.write('/api/v1/auth/login', {
      identifier: person.username,
      password,
    });
    expect(logged.status).toBe(200);
    expect(browser.cookies.get('pm-session') !== session).toBe(true);
    const previous = new AuthHttp(base);
    if (session) previous.cookies.set('pm-session', session);
    expect((await previous.raw('/api/v1/auth/sessions')).status).toBe(401);
    expect(
      (await browser.write('/api/v1/auth/sessions/' + randomUUID(), undefined, 'DELETE')).status,
    ).toBe(404);
    const flags =
      logged.headers.getSetCookie().filter((value) => value.startsWith('pm-session='))[0] ?? '';
    expect(
      flags.includes('HttpOnly') && flags.includes('SameSite=Lax') && flags.includes('Path=/'),
    ).toBe(true);
    expect((await browser.raw('/api/v1/admin/settings/brand')).status).toBe(403);
    expect((await browser.raw('/api/v1/auth/sessions')).status).toBe(200);
    expect((await browser.write('/api/v1/auth/logout')).status).toBe(200);
    expect((await browser.context()).data.assurance).toBe('anonymous');
    expect((await browser.raw('/api/v1/auth/sessions')).status).toBe(401);
  });
  it('拒绝 CSRF、跨 Origin、伪造角色，登录账户限流生效', async () => {
    const person = registration();
    const browser = new AuthHttp(base);
    const context = await browser.context();
    expect(
      (
        await browser.raw('/api/v1/auth/login', {
          method: 'POST',
          headers: { Origin: browser.origin },
          body: JSON.stringify({ identifier: person.username, password }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await browser.raw('/api/v1/auth/login', {
          method: 'POST',
          headers: { Origin: 'https://untrusted.invalid', 'X-CSRF-Token': context.data.csrfToken },
          body: JSON.stringify({ identifier: person.username, password }),
        })
      ).status,
    ).toBe(403);
    expect(
      (await browser.write('/api/v1/auth/register', { ...person, role: 'admin' })).status,
    ).toBe(400);
    for (let index = 0; index < 5; index++)
      expect(
        (
          await browser.write('/api/v1/auth/login', {
            identifier: person.username,
            password: 'incorrect',
          })
        ).status,
      ).toBe(401);
    expect(
      (
        await browser.write('/api/v1/auth/login', {
          identifier: person.username,
          password: 'incorrect',
        })
      ).status,
    ).toBe(429);
  });
  it('找回响应不暴露账号，邮件重置单次使用并撤销既有会话', async () => {
    const person = registration();
    const browser = new AuthHttp(base);
    await browser.write('/api/v1/auth/register', person);
    await browser.write('/api/v1/auth/login', { identifier: person.username, password });
    const before = await browser.context();
    expect(before.data.account?.username).toBe(person.username);
    const existing = await browser.write('/api/v1/auth/forgot-password', { email: person.email });
    const missing = await browser.write('/api/v1/auth/forgot-password', {
      email: registration().email,
    });
    expect(await existing.json()).toEqual(await missing.json());
    const token = await mailToken(person.email, 'reset-password', tick);
    const next = 'A changed real passphrase for testing';
    expect(
      (await browser.write('/api/v1/auth/reset-password', { token, password: next })).status,
    ).toBe(200);
    expect((await browser.context()).data.assurance).toBe('anonymous');
    expect(
      (await browser.write('/api/v1/auth/reset-password', { token, password: next })).status,
    ).toBe(400);
    expect(
      (await browser.write('/api/v1/auth/login', { identifier: person.username, password: next }))
        .status,
    ).toBe(200);
    expect((await browser.write('/api/v1/auth/sessions', undefined, 'DELETE')).status).toBe(200);
    expect((await browser.context()).data.assurance).toBe('anonymous');
  });
  it('受控管理员创建、自愿绑定 MFA、恢复码与动态码重放保护、真实品牌权限', async () => {
    const person = registration();
    await createAdministrator(owner, person);
    const browser = new AuthHttp(base);
    expect(
      (await browser.write('/api/v1/auth/login', { identifier: person.username, password })).status,
    ).toBe(200);
    expect((await browser.context()).data.assurance).toBe('authenticated');
    expect((await browser.raw('/api/v1/admin/settings/brand')).status).toBe(200);
    const setup = await browser.write('/api/v1/auth/mfa/setup');
    const enrollment = z
      .object({ data: z.object({ secret: z.string(), uri: z.string(), qrDataUrl: z.string() }) })
      .parse(await setup.json());
    expect(enrollment.data.qrDataUrl.startsWith('data:image/png;base64,')).toBe(true);
    const otp = createTotp(enrollment.data.secret, person.username);
    const code = otp.generate();
    const confirmed = await browser.write('/api/v1/auth/mfa/confirm', { code });
    expect(confirmed.status).toBe(200);
    const recovery = z
      .object({ data: z.object({ recoveryCodes: z.array(z.string()).length(10) }) })
      .parse(await confirmed.json());
    expect((await browser.context()).data.assurance).toBe('authenticated');
    const brand = await browser.raw('/api/v1/admin/settings/brand');
    expect(brand.status).toBe(200);
    const data = z
      .object({
        data: z.object({
          name: z.string(),
          description: z.string(),
          defaultLocale: z.literal('zh-CN'),
        }),
      })
      .parse(await brand.json());
    expect(
      (
        await browser.write(
          '/api/v1/admin/settings/brand',
          { ...data.data, name: '验证后的管理员品牌' },
          'PATCH',
          { 'If-Match': brand.headers.get('etag') ?? '' },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await browser.write('/api/v1/admin/settings/brand', data.data, 'PATCH', {
          'If-Match': brand.headers.get('etag') ?? '',
        })
      ).status,
    ).toBe(412);
    await browser.write('/api/v1/auth/logout');
    await browser.write('/api/v1/auth/login', { identifier: person.username, password });
    expect((await browser.context()).data.assurance).toBe('mfa_required');
    expect((await browser.write('/api/v1/auth/mfa/verify', { code })).status).toBe(400);
    expect(
      (await browser.write('/api/v1/auth/mfa/verify', { code: recovery.data.recoveryCodes[0] }))
        .status,
    ).toBe(200);
    await browser.write('/api/v1/auth/logout');
    await browser.write('/api/v1/auth/login', { identifier: person.username, password });
    expect(
      (await browser.write('/api/v1/auth/mfa/verify', { code: recovery.data.recoveryCodes[0] }))
        .status,
    ).toBe(400);
    const future = otp.generate({ timestamp: Date.now() + 30000 });
    expect((await browser.write('/api/v1/auth/mfa/verify', { code: future })).status).toBe(200);
    const cipher = await owner.pool.query<{ encrypted_secret: string }>(
      'SELECT encrypted_secret FROM user_mfa WHERE user_id=$1',
      [(await browser.context()).data.account?.id],
    );
    expect(cipher.rows[0]?.encrypted_secret.includes(enrollment.data.secret)).toBe(false);
    expect((await browser.write('/api/v1/auth/mfa/setup')).status).toBe(409);
  });
});
