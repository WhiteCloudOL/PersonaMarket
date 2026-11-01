import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const storage = join(root, 'data/tests/e2e-storage');
function currentDirectories() {
  return existsSync(storage) ? readdirSync(storage).sort() : [];
}
function startFailedService(extra: { E2E_STORAGE_ROOT?: string } = {}) {
  return spawnSync(process.execPath, ['scripts/serve-e2e.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      TEST_DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:1/lifecycle_test',
      POSTGRES_APP_PASSWORD: 'fixture-password-for-startup-only',
      STORAGE_ROOT: join(root, 'data/storage'),
      E2E_STORAGE_ROOT: undefined,
      ...extra,
    },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10000,
  });
}

it('真实测试服务连接失败时回收自动分配目录，不沿用业务 STORAGE_ROOT', () => {
  const before = currentDirectories();
  const result = startFailedService();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('ECONNREFUSED');
  expect(result.stderr).not.toContain('test.storage.cleanup.failed');
  expect(currentDirectories()).toEqual(before);
});

it('真实服务在连接数据库前拒绝将业务目录作为测试素材目录', () => {
  const before = currentDirectories();
  const result = startFailedService({ E2E_STORAGE_ROOT: join(root, 'data/storage') });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('E2E_STORAGE_NOT_ISOLATED');
  expect(result.stderr).not.toContain('ECONNREFUSED');
  expect(currentDirectories()).toEqual(before);
});
