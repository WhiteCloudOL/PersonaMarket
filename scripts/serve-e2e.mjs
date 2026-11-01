import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createServer, request as httpRequest } from 'node:http';
import { cpSync } from 'node:fs';
import { join } from 'node:path';
import { createApplication } from '@personamarket/api/testing';
import { createDatabase, migrateDatabase } from '@personamarket/database';
import {
  createLogger,
  createSystemQueue,
  createSystemWorker,
  dispatchOutbox,
  MailSender,
  MailConfigurationStore,
  LocalStorage,
  parseServerEnvironment,
  webEnvironment,
} from '@personamarket/server';
import { environment, root, supervise } from './runtime.mjs';
import { listenHttp, reserveHttpOrigin } from './http-server.ts';
import { createE2eStorage } from './e2e-storage.ts';
import { e2eQueueName } from './e2e-queue.ts';

const startupStarted = performance.now();
const startupStage = (stage, httpStatus) =>
  console.error(
    JSON.stringify({
      event: 'test.webserver.stage',
      stage,
      elapsedMs: Math.round(performance.now() - startupStarted),
      ...(typeof httpStatus === 'number' ? { httpStatus } : {}),
    }),
  );
startupStage('started');

const source = environment();
const testUrl = source.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test'))
  throw new Error('E2E 要求独立测试数据库。');
if (!source.POSTGRES_APP_PASSWORD) throw new Error('E2E 缺少应用数据库凭据');
const storage = createE2eStorage(root, source.E2E_STORAGE_ROOT);
const owner = createDatabase(testUrl);
try {
  await owner.pool.query('GRANT USAGE ON SCHEMA public TO personamarket_app');
  await owner.pool.query(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO personamarket_app',
  );
} finally {
  await owner.close();
}
await migrateDatabase(testUrl);
startupStage('migrations_ready');
const appUrl = new URL(testUrl);
appUrl.username = 'personamarket_app';
appUrl.password = source.POSTGRES_APP_PASSWORD;
const env = parseServerEnvironment({
  ...source,
  NODE_ENV: 'test',
  STORAGE_ROOT: storage.directory,
  DATABASE_URL: appUrl.href,
  QUEUE_NAME: e2eQueueName(testUrl),
  PUBLIC_ORIGIN: source.PLAYWRIGHT_ORIGIN ?? 'http://127.0.0.1:3100',
  API_PORT: '3001',
  LOG_LEVEL: 'error',
  AUTH_REGISTRATION_ENABLED: 'true',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '11025',
  SMTP_FROM: 'no-reply@personamarket.test',
  SMTP_USER: '',
  SMTP_PASSWORD: '',
  SMTP_SECURE: 'false',
});
const app = await createApplication(env);
const apiOrigin = await listenHttp(app);
startupStage('api_listening');
const nextPort = new URL(await reserveHttpOrigin()).port;
// Next 的 rewrites 在构建期固定；测试入口转发到真实 API/Next 的动态端口。
let observedNext = false;
const proxy = createServer((request, response) => {
  const target = new URL(
    request.url?.startsWith('/api/v1/') ? apiOrigin : 'http://127.0.0.1:' + nextPort,
  );
  const upstream = httpRequest(
    {
      hostname: target.hostname,
      port: target.port,
      path: request.url ?? '/',
      method: request.method,
      headers: { ...request.headers, host: target.host },
    },
    (incoming) => {
      if (!observedNext && !request.url?.startsWith('/api/v1/')) {
        startupStage('next_http_response', incoming.statusCode);
        observedNext = true;
      }
      response.writeHead(incoming.statusCode ?? 502, incoming.headers);
      incoming.pipe(response);
    },
  );
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  });
  request.on('aborted', () => upstream.destroy());
  request.pipe(upstream);
});
await new Promise((resolve, reject) => {
  proxy.once('error', reject);
  proxy.listen(Number(new URL(env.PUBLIC_ORIGIN).port), '127.0.0.1', resolve);
});
startupStage('proxy_listening');
// 邮件 Worker 复用本测试服务进程，不额外启动测试 Worker 子进程。
const database = createDatabase(appUrl.href);
const logger = createLogger('e2e-mail', 'silent');
const mailSettings = new MailConfigurationStore(database, env);
const sender = new MailSender(env, () => mailSettings.current());
const queue = createSystemQueue(env.REDIS_URL, env.QUEUE_NAME);
await queue.waitUntilReady();
const worker = createSystemWorker(
  database,
  env.REDIS_URL,
  queue.name,
  logger,
  {
    sender,
    encryptionKey: env.APP_ENCRYPTION_KEY,
  },
  { storage: new LocalStorage(env.STORAGE_ROOT) },
);
await worker.waitUntilReady();
startupStage('worker_ready');
let pending;
const timer = setInterval(() => {
  if (pending) return;
  pending = dispatchOutbox(database, queue, logger)
    .catch(() => {
      process.exitCode = 1;
    })
    .finally(() => {
      pending = undefined;
    });
}, 500);
const standalone = join(root, 'apps/web/.next/standalone/apps/web');
startupStage('next_assets_copying');
cpSync(join(root, 'apps/web/.next/static'), join(standalone, '.next/static'), { recursive: true });
cpSync(join(root, 'apps/web/public'), join(standalone, 'public'), { recursive: true });
startupStage('next_assets_copied');
const next = spawn(process.execPath, [join(standalone, 'server.js')], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
  env: {
    ...webEnvironment(source),
    NODE_ENV: 'production',
    PORT: String(nextPort),
    HOSTNAME: '127.0.0.1',
    API_INTERNAL_ORIGIN: apiOrigin,
    NEXT_TELEMETRY_DISABLED: '1',
  },
});
startupStage('next_started');
next.once('exit', () => {
  startupStage('next_exited');
  clearInterval(timer);
  void (async () => {
    await pending;
    await new Promise((resolve, reject) => {
      proxy.closeAllConnections();
      proxy.close((error) => (error ? reject(error) : resolve()));
    });
    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
    sender.close();
    await database.close();
    await app.close();
    storage.cleanup();
  })().catch(() => {
    process.exitCode = 1;
  });
});
supervise([next]);
