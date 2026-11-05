import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import { createApplication } from '@personamarket/api/testing';
import { createDatabase, createTestDatabaseOwner, migrateDatabase } from '@personamarket/database';
import { createTestDatabase, dropTestDatabase } from '../../scripts/test-database.js';
import {
  createAdministrator,
  createLogger,
  createSystemQueue,
  createSystemWorker,
  createTotp,
  dispatchOutbox,
  MailConfigurationStore,
  MailSender,
  LocalStorage,
  parseServerEnvironment,
} from '@personamarket/server';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { AuthHttp } from './auth-http.js';
import { testEnvironment } from './environment.js';
import { listenHttp } from '../../scripts/http-server.js';

/** 每套场景独立数据库和队列；HTTP API、SMTP Worker 复用当前测试进程。 */
export async function createAuthStack(options: { isolatedStorage?: boolean } = {}) {
  const source = process.env['TEST_DATABASE_URL'];
  const applicationPassword = process.env['POSTGRES_APP_PASSWORD'];
  const redis = process.env['REDIS_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test') || !applicationPassword || !redis)
    throw new Error('缺少真实测试依赖');
  const cleanup: Array<() => Promise<unknown>> = [];
  const close = async () => {
    const errors: unknown[] = [];
    for (const action of cleanup.reverse()) {
      try {
        await action();
      } catch (cause) {
        errors.push(cause);
      }
    }
    cleanup.length = 0;
    if (errors.length) throw new AggregateError(errors, '认证测试资源清理失败');
  };
  try {
    const administrator = createTestDatabaseOwner(source);
    cleanup.push(() => administrator.close());
    const name = 'pm_auth_case_' + randomUUID().replaceAll('-', '') + '_test';
    await createTestDatabase(administrator, name);
    cleanup.push(() => dropTestDatabase(administrator, name));
    const ownerUrl = new URL(source);
    ownerUrl.pathname = '/' + name;
    const owner = createDatabase(ownerUrl.href);
    cleanup.push(() => owner.close());
    await owner.pool.query('GRANT USAGE ON SCHEMA public TO personamarket_app');
    await owner.pool.query(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO personamarket_app',
    );
    await migrateDatabase(ownerUrl.href);
    const appUrl = new URL(ownerUrl);
    appUrl.username = 'personamarket_app';
    appUrl.password = applicationPassword;
    const queueName = 'auth-case-' + randomUUID();
    const env = parseServerEnvironment({
      ...testEnvironment(appUrl.href),
      ...(options.isolatedStorage
        ? {
            STORAGE_ROOT: fileURLToPath(
              new URL('../../data/tests/auth-cases/' + name + '/storage/', import.meta.url),
            ),
          }
        : {}),
      REDIS_URL: redis,
      QUEUE_NAME: queueName,
      AUTH_REGISTRATION_ENABLED: 'true',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '11025',
      SMTP_FROM: 'no-reply@personamarket.test',
    });
    const app = await createApplication(env);
    cleanup.push(() => app.close());
    const base = await listenHttp(app);
    const server: unknown = app.getHttpServer();
    if (!(server instanceof Server)) throw new Error('测试应用必须使用真实 HTTP 服务');
    const workerDatabase = createDatabase(appUrl.href);
    cleanup.push(() => workerDatabase.close());
    const mail = new MailConfigurationStore(workerDatabase, env);
    const sender = new MailSender(env, () => mail.current());
    cleanup.push(async () => sender.close());
    const logger = createLogger('auth-case', 'silent');
    const queue = createSystemQueue(redis, env.QUEUE_NAME);
    cleanup.push(() => queue.close());
    await queue.waitUntilReady();
    cleanup.push(() => queue.obliterate({ force: true }));
    const worker = createSystemWorker(
      workerDatabase,
      redis,
      queue.name,
      logger,
      {
        sender,
        encryptionKey: env.APP_ENCRYPTION_KEY,
      },
      { storage: new LocalStorage(env.STORAGE_ROOT) },
    );
    cleanup.push(() => worker.close());
    await worker.waitUntilReady();
    const browser = () => new AuthHttp(base);
    const admin = async () => {
      const username = 'admin_' + randomUUID().replaceAll('-', '').slice(0, 12);
      const credentials = {
        username,
        email: username + '@fixture.invalid',
        password: 'A fixture administrator passphrase 2026',
      };
      await createAdministrator(owner, credentials);
      const http = browser();
      const login = await http.write('/api/v1/auth/login', {
        identifier: username,
        password: credentials.password,
      });
      if (login.status !== 200) throw new Error('管理员测试登录失败');
      const setup = z
        .object({ data: z.object({ secret: z.string() }) })
        .parse(await (await http.write('/api/v1/auth/mfa/setup')).json());
      const confirmation = await http.write('/api/v1/auth/mfa/confirm', {
        code: createTotp(setup.data.secret, username).generate(),
      });
      if (confirmation.status !== 200) throw new Error('管理员测试二次验证失败');
      return { http, credentials };
    };
    return {
      owner,
      server,
      env,
      worker,
      browser,
      admin,
      tick: () => dispatchOutbox(workerDatabase, queue, logger),
      close,
    };
  } catch (cause) {
    await close();
    throw cause;
  }
}
