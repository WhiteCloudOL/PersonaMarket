import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { assertE2eStoragePath, createE2eStorage } from '../../scripts/e2e-storage.js';

const testRoot = fileURLToPath(new URL('../../data/tests/', import.meta.url));
const roots: string[] = [];
const stores: Array<ReturnType<typeof createE2eStorage>> = [];
function fixture() {
  mkdirSync(testRoot, { recursive: true });
  const root = mkdtempSync(join(testRoot, 'e2e-storage-unit-'));
  roots.push(root);
  const production = join(root, 'data/storage');
  mkdirSync(production, { recursive: true });
  writeFileSync(join(production, 'sentinel.txt'), 'existing private asset');
  return { root, production };
}
afterEach(() => {
  for (const store of stores.splice(0)) store.cleanup();
  for (const root of roots.splice(0)) {
    const path = relative(realpathSync(testRoot), realpathSync(root));
    if (isAbsolute(path) || path.includes(sep) || !basename(path).startsWith('e2e-storage-unit-'))
      throw new Error('拒绝清理非本用例创建的目录');
    rmSync(root, { recursive: true });
  }
});

it('默认入口按本轮创建独立私有存储，清理不影响业务存储或另一轮测试', () => {
  const { root, production } = fixture();
  const one = createE2eStorage(root);
  const two = createE2eStorage(root);
  stores.push(one, two);
  expect(one.directory).not.toBe(two.directory);
  expect(resolve(one.directory).startsWith(join(root, 'data/tests/e2e-storage') + sep)).toBe(true);
  expect(() => assertE2eStoragePath(root, one.directory)).not.toThrow();
  writeFileSync(join(one.directory, randomUUID()), 'isolated asset');
  writeFileSync(join(two.directory, 'retained.txt'), 'other run');
  one.cleanup();
  one.cleanup();
  expect(existsSync(one.directory)).toBe(false);
  expect(readFileSync(join(two.directory, 'retained.txt'), 'utf8')).toBe('other run');
  expect(readFileSync(join(production, 'sentinel.txt'), 'utf8')).toBe('existing private asset');
});

it('运行时强制拒绝主站、测试根、越界和非受控路径', () => {
  const { root, production } = fixture();
  for (const candidate of [
    production,
    join(root, 'data/tests'),
    join(root, 'data/tests/e2e-storage'),
    join(root, 'data/tests/e2e-storage/../run-escape'),
    resolve(root, '../outside'),
  ])
    expect(() => assertE2eStoragePath(root, candidate)).toThrow('E2E_STORAGE_NOT_ISOLATED');
  expect(() => createE2eStorage(root, production)).toThrow('E2E_STORAGE_NOT_ISOLATED');
});

it('服务借用父运行器的目录时不擅自清理，父进程仍完整回收', () => {
  const { root } = fixture();
  const owner = createE2eStorage(root);
  stores.push(owner);
  const borrowed = createE2eStorage(root, owner.directory);
  writeFileSync(join(owner.directory, 'in-use.txt'), 'owned by runner');
  borrowed.cleanup();
  expect(readFileSync(join(owner.directory, 'in-use.txt'), 'utf8')).toBe('owned by runner');
  owner.cleanup();
  expect(existsSync(owner.directory)).toBe(false);
});

it('拒绝指向主站的 junction/symlink，不创建或删除主站文件', () => {
  const { root, production } = fixture();
  mkdirSync(join(root, 'data/tests'));
  symlinkSync(production, join(root, 'data/tests/e2e-storage'), 'junction');
  expect(() => createE2eStorage(root)).toThrow('E2E_STORAGE_NOT_ISOLATED');
  expect(readFileSync(join(production, 'sentinel.txt'), 'utf8')).toBe('existing private asset');
  expect(readdirSync(production)).toEqual(['sentinel.txt']);
});

for (const failure of ['exit', 'throw'] as const) {
  it(`继承业务 STORAGE_ROOT 时仍隔离，${failure} 异常退出自动回收本轮素材`, () => {
    const { root, production } = fixture();
    const module = new URL('../../scripts/e2e-storage.ts', import.meta.url).href;
    const code = `import {createE2eStorage} from ${JSON.stringify(module)};
      import {writeFileSync} from 'node:fs'; import {join} from 'node:path';
      const store=createE2eStorage(${JSON.stringify(root)});
      writeFileSync(join(store.directory,'fixture.txt'),'temporary asset');
      console.log(JSON.stringify({directory:store.directory}));
      ${failure === 'exit' ? 'process.exit(7)' : "throw new Error('fixture startup failure')"};`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      encoding: 'utf8',
      env: { ...process.env, STORAGE_ROOT: production },
      windowsHide: true,
      timeout: 10000,
    });
    expect(result.status).toBe(failure === 'exit' ? 7 : 1);
    const output: unknown = JSON.parse(result.stdout);
    expect(output).toEqual({ directory: expect.any(String) });
    if (!output || typeof output !== 'object' || !('directory' in output))
      throw new Error('子进程未返回测试目录');
    expect(typeof output.directory).toBe('string');
    if (typeof output.directory !== 'string') throw new Error('缺少子进程测试目录');
    expect(existsSync(output.directory)).toBe(false);
    expect(readFileSync(join(production, 'sentinel.txt'), 'utf8')).toBe('existing private asset');
  });
}
