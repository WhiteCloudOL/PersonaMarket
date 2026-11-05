import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { listSourceFiles } from '../../scripts/source-files.js';

it('枚举全部受跟踪源码和未忽略新文件，保留忽略目录的拒绝访问权限', async () => {
  const parent = new URL('../../data/tests/', import.meta.url);
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(fileURLToPath(new URL('source-enumeration-', parent)));
  const privateDirectory = join(directory, 'data', 'postgres');
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: directory, windowsHide: true });
    await writeFile(join(directory, '.gitignore'), 'data/\n');
    await writeFile(join(directory, 'tracked.ts'), 'export const tracked = true;\n');
    await writeFile(join(directory, 'deleted.ts'), 'export {};\n');
    execFileSync('git', ['add', '.gitignore', 'tracked.ts', 'deleted.ts'], {
      cwd: directory,
      windowsHide: true,
    });
    await rm(join(directory, 'deleted.ts'));
    await writeFile(join(directory, 'new.ts'), 'export const added = true;\n');
    await mkdir(privateDirectory, { recursive: true });
    await writeFile(join(privateDirectory, 'private-data.txt'), 'private fixture');
    if (process.platform !== 'win32') await chmod(privateDirectory, 0o000);
    expect(listSourceFiles(directory).sort()).toEqual(['.gitignore', 'new.ts', 'tracked.ts']);
  } finally {
    await chmod(privateDirectory, 0o700).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});
