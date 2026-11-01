import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import './prepare-data.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const secret = () => randomBytes(32).toString('hex');
const owner = secret();
const application = secret();
const redis = secret();
const environment = {
  NODE_ENV: 'development',
  PUBLIC_ORIGIN: 'http://127.0.0.1:3000',
  API_INTERNAL_ORIGIN: 'http://127.0.0.1:3001',
  API_PORT: '3001',
  POSTGRES_USER: 'personamarket_owner',
  POSTGRES_DB: 'personamarket',
  POSTGRES_PASSWORD: owner,
  POSTGRES_APP_PASSWORD: application,
  REDIS_PASSWORD: redis,
  DATABASE_URL: `postgresql://personamarket_app:${application}@127.0.0.1:15432/personamarket`,
  MIGRATION_DATABASE_URL: `postgresql://personamarket_owner:${owner}@127.0.0.1:15432/personamarket`,
  TEST_DATABASE_URL: `postgresql://personamarket_owner:${owner}@127.0.0.1:15432/personamarket_test`,
  REDIS_URL: `redis://:${redis}@127.0.0.1:16379/0`,
  APP_ENCRYPTION_KEY: secret(),
  STATS_HMAC_KEY: secret(),
  STORAGE_ROOT: join(root, 'data', 'storage').replaceAll('\\', '/'),
  CADDY_DOMAIN: 'localhost',
  LOG_LEVEL: 'info',
  TRUST_PROXY_HOPS: '0',
  QUEUE_NAME: 'personamarket-system',
  WORKER_POLL_INTERVAL_MS: '1000',
  AUTH_REGISTRATION_ENABLED: 'true',
  AUTH_SESSION_TTL_SECONDS: '86400',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '11025',
  SMTP_SECURE: 'false',
  SMTP_FROM: 'no-reply@personamarket.test',
};
try {
  writeFileSync(
    join(root, '.env'),
    Object.entries(environment)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  console.log('已生成 .env；凭据仅写入本机文件，未输出到终端。');
} catch (cause) {
  console.error(
    cause.code === 'EEXIST'
      ? '.env 已存在，已保留；请按 .env.example 手动补充缺失项。'
      : '无法写入 .env。',
  );
  process.exitCode = 1;
}
