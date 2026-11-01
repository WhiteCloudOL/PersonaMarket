import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

function rejectStorage(): never {
  throw new Error('E2E_STORAGE_NOT_ISOLATED');
}

function checkedDirectory(directory: string) {
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) rejectStorage();
}

/** 只允许 workspace/data/tests/e2e-storage 下由本轮生成的直接子目录 */
export function assertE2eStoragePath(workspace: string, candidate: string) {
  const root = realpathSync(workspace);
  const base = join(root, 'data/tests/e2e-storage');
  const directory = resolve(candidate);
  const path = relative(base, directory);
  if (!/^run-[A-Za-z0-9]{6}$/.test(path) || dirname(directory) !== base) rejectStorage();
  let current = root;
  for (const part of ['data', 'tests', 'e2e-storage', path]) {
    current = join(current, part);
    checkedDirectory(current);
  }
  if (relative(base, realpathSync(directory)) !== path) rejectStorage();
  return directory;
}

/** 父运行器拥有目录；服务借用时只验路径，避免子进程提前删除仍在使用的素材 */
export function createE2eStorage(workspace: string, borrowedDirectory?: string) {
  if (borrowedDirectory)
    return { directory: assertE2eStoragePath(workspace, borrowedDirectory), cleanup() {} };
  const root = realpathSync(workspace);
  let base = root;
  for (const part of ['data', 'tests', 'e2e-storage']) {
    base = join(base, part);
    if (!existsSync(base)) mkdirSync(base, { mode: 0o700 });
    checkedDirectory(base);
  }
  const directory = mkdtempSync(join(base, 'run-'));
  assertE2eStoragePath(root, directory);
  let cleaned = false;
  function cleanup() {
    if (cleaned) return;
    if (existsSync(directory)) {
      // 删除前重新核对目录边界和 junction，绝不按继承的业务 STORAGE_ROOT 清理
      assertE2eStoragePath(root, directory);
      rmSync(directory, { recursive: true });
    }
    cleaned = true;
    process.off('exit', onExit);
  }
  function onExit() {
    try {
      cleanup();
    } catch {
      process.stderr.write('{"event":"test.storage.cleanup.failed"}\n');
      process.exitCode = 1;
    }
  }
  process.once('exit', onExit);
  return { directory: directory.split(sep).join('/'), cleanup };
}
