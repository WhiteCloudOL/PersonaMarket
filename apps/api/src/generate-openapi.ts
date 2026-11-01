import { writeFile } from 'node:fs/promises';
import { parseServerEnvironment } from '@personamarket/server';
import { createApplication } from './app.js';
import { createApiDocument } from './openapi-document.js';

const output = process.argv[2];
if (!output) throw new Error('请指定 OpenAPI 输出文件。');
// 仅生成路由契约；连接池惰性连接，不读取开发或生产秘密。
const env = parseServerEnvironment({
  NODE_ENV: 'test',
  PUBLIC_ORIGIN: 'http://localhost:3000',
  API_INTERNAL_ORIGIN: 'http://localhost:3001',
  DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/openapi_generation',
  REDIS_URL: 'redis://127.0.0.1:1',
  APP_ENCRYPTION_KEY: 'a'.repeat(64),
  STATS_HMAC_KEY: 'b'.repeat(64),
  STORAGE_ROOT: process.cwd(),
  CADDY_DOMAIN: 'localhost',
  LOG_LEVEL: 'silent',
});
const app = await createApplication(env);
try {
  await app.init();
  await writeFile(output, JSON.stringify(createApiDocument(app), null, 2) + '\n');
} finally {
  await app.close();
}
