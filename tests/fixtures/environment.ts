import { fileURLToPath } from 'node:url';
export function testEnvironment(
  databaseUrl = 'postgresql://test:fixture-password@127.0.0.1:1/personamarket_test',
) {
  return {
    NODE_ENV: 'test' as const,
    PUBLIC_ORIGIN: 'http://127.0.0.1:3100',
    API_INTERNAL_ORIGIN: 'http://127.0.0.1:3001',
    DATABASE_URL: databaseUrl,
    REDIS_URL: 'redis://127.0.0.1:1/1',
    APP_ENCRYPTION_KEY: 'a'.repeat(64),
    STATS_HMAC_KEY: 'b'.repeat(64),
    STORAGE_ROOT: fileURLToPath(new URL('../../data/tests/storage/', import.meta.url)),
    CADDY_DOMAIN: 'localhost',
    LOG_LEVEL: 'silent',
  };
}
