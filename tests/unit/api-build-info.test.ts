import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { parseApiBuildRecord } from '../../apps/api/src/build-info.js';

it('API运行信息只接受完整产物记录，实际Node不受人工运行环境标签影响', () => {
  const build = {
    version: '0.0.0',
    sourceRevision: 'a'.repeat(40),
    sourceDirty: true,
    builtAt: '2026-11-01T00:00:00.000Z',
    status: 'available',
  };
  expect(parseApiBuildRecord(build)).toEqual({
    data: { component: 'api', build, nodeVersion: process.versions.node },
  });
  for (const value of [
    null,
    { ...build, sourceRevision: 'latest' },
    { ...build, sourceDirty: null },
    { ...build, builtAt: null },
    { ...build, status: 'unavailable' },
    { ...build, databaseUrl: 'private fixture' },
  ]) {
    expect(parseApiBuildRecord(value).data.build).toEqual({
      version: null,
      sourceRevision: null,
      sourceDirty: null,
      builtAt: null,
      status: 'unavailable',
    });
  }
});

it('构建入口固化真实Git clean/dirty及提交变化，源码包缺失元数据时保持未知', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pm-build-source-'));
  const cleanup = () => {
    if (
      dirname(resolve(directory)) !== resolve(tmpdir()) ||
      !basename(directory).startsWith('pm-build-source-')
    )
      throw Error('临时构建夹具路径超出本轮范围');
    rmSync(directory, { recursive: true, force: true });
  };
  const moduleUrl = new URL('../../scripts/build-provenance.mjs', import.meta.url).href;
  const program = `import {captureBuildSource} from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(captureBuildSource(process.env.PM_TEST_BUILD_ROOT)));`;
  const capture = () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      env: { ...process.env, PM_TEST_BUILD_ROOT: directory, PM_API_BUILD_SOURCE: '' },
      encoding: 'utf8',
      windowsHide: true,
    });
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout) as unknown;
  };
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8', windowsHide: true });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  };
  try {
    mkdirSync(join(directory, 'apps/api'), { recursive: true });
    writeFileSync(join(directory, 'apps/api/package.json'), JSON.stringify({ version: '0.0.0' }));
    expect(capture()).toBeNull();
    git('init');
    git('add', '.');
    git(
      '-c',
      'user.name=Build Fixture',
      '-c',
      'user.email=build@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'test(build): initial fixture',
    );
    const firstRevision = git('rev-parse', 'HEAD');
    expect(capture()).toEqual({
      version: '0.0.0',
      sourceRevision: firstRevision,
      sourceDirty: false,
    });
    writeFileSync(join(directory, 'new.txt'), 'owned build fixture');
    expect(capture()).toEqual({
      version: '0.0.0',
      sourceRevision: firstRevision,
      sourceDirty: true,
    });
    git('add', '.');
    git(
      '-c',
      'user.name=Build Fixture',
      '-c',
      'user.email=build@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'test(build): next fixture',
    );
    const nextRevision = git('rev-parse', 'HEAD');
    expect(nextRevision).not.toBe(firstRevision);
    expect(capture()).toEqual({
      version: '0.0.0',
      sourceRevision: nextRevision,
      sourceDirty: false,
    });
  } finally {
    cleanup();
  }
});
