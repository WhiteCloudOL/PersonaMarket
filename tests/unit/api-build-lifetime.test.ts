import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

it('同一API进程保留启动产物快照，新进程才读取下一次构建', () => {
  const testsRoot = fileURLToPath(new URL('../../data/tests/', import.meta.url));
  mkdirSync(testsRoot, { recursive: true });
  const directory = mkdtempSync(join(testsRoot, 'api-build-lifetime-'));
  const cleanup = () => {
    if (
      dirname(resolve(directory)) !== resolve(testsRoot) ||
      !basename(directory).startsWith('api-build-lifetime-')
    )
      throw Error('构建生命周期夹具超出本轮路径');
    rmSync(directory, { recursive: true, force: true });
  };
  const initial = {
    version: '0.0.0',
    sourceRevision: 'a'.repeat(40),
    sourceDirty: true,
    builtAt: '2026-11-01T00:00:00.000Z',
    status: 'available',
  };
  const next = {
    ...initial,
    sourceRevision: 'b'.repeat(40),
    sourceDirty: false,
    builtAt: '2026-11-01T01:00:00.000Z',
  };
  try {
    const entry = join(directory, 'build-info.ts'),
      record = join(directory, 'build-info.json');
    cpSync(new URL('../../apps/api/src/build-info.ts', import.meta.url), entry);
    writeFileSync(record, JSON.stringify(initial));
    const moduleUrl = pathToFileURL(entry).href;
    const execute = (program: string) => {
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', program], {
        cwd: testsRoot,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15000,
        env: {
          ...process.env,
          PM_API_BUILD_SOURCE: JSON.stringify({ ...next, version: 'runtime-env-must-not-be-used' }),
        },
      });
      expect(child.status, child.stderr).toBe(0);
      return JSON.parse(child.stdout) as unknown;
    };
    const result = execute(
      `import {writeFileSync} from 'node:fs'; const {readApiBuildInfo}=await import(${JSON.stringify(moduleUrl)}); const first=await readApiBuildInfo(); writeFileSync(${JSON.stringify(record)}, ${JSON.stringify(JSON.stringify(next))}); const second=await readApiBuildInfo(); console.log(JSON.stringify({first,second}));`,
    );
    expect(result).toEqual({
      first: { data: { component: 'api', build: initial, nodeVersion: process.versions.node } },
      second: { data: { component: 'api', build: initial, nodeVersion: process.versions.node } },
    });
    expect(
      execute(
        `const {readApiBuildInfo}=await import(${JSON.stringify(moduleUrl)}); console.log(JSON.stringify(await readApiBuildInfo()));`,
      ),
    ).toEqual({ data: { component: 'api', build: next, nodeVersion: process.versions.node } });
  } finally {
    cleanup();
  }
});
