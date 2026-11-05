import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { removeUnusedSystemZlib } from '../../infra/docker/runtime-zlib.js';

async function fixture() {
  const parent = fileURLToPath(new URL('../../data/tests/', import.meta.url));
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'runtime-package-'));
  const metadata = join(root, 'var/lib/dpkg/status.d');
  const library = join(root, 'usr/lib/test-linux-gnu/libz.so.1.3.1');
  const other = join(root, 'usr/lib/test-linux-gnu/libother.so.1');
  await mkdir(metadata, { recursive: true });
  await mkdir(join(root, 'usr/lib/test-linux-gnu'), { recursive: true });
  await writeFile(library, 'controlled system library');
  await writeFile(other, 'retained component');
  await writeFile(join(metadata, 'zlib1g'), 'Package: zlib1g\nVersion: 1.3.1\n');
  const checksum = createHash('md5')
    .update(await readFile(library))
    .digest('hex');
  await writeFile(
    join(metadata, 'zlib1g.md5sums'),
    `${checksum}  usr/lib/test-linux-gnu/libz.so.1.3.1\n`,
  );
  return { root, metadata, library, other };
}

it('裁剪只删除经过包校验和核对的库及对应安装记录，保留其他组件', async () => {
  const f = await fixture();
  try {
    const result = await removeUnusedSystemZlib(f.root);
    expect(result.version).toBe('1.3.1');
    await expect(stat(f.library)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(f.metadata, 'zlib1g'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(f.other, 'utf8')).toBe('retained component');
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

it('包清单中的越界路径会在删除前被拒绝', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.metadata, 'zlib1g.md5sums'), `${'0'.repeat(32)}  ../../outside\n`);
    await expect(removeUnusedSystemZlib(f.root)).rejects.toThrow('ZLIB_MANIFEST_UNSAFE');
    expect(await readFile(f.library, 'utf8')).toBe('controlled system library');
    await expect(stat(join(f.metadata, 'zlib1g'))).resolves.toBeDefined();
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

it('库文件与包清单不一致时保留文件和安装记录，阻断构建', async () => {
  const f = await fixture();
  try {
    await writeFile(f.library, 'modified component');
    await expect(removeUnusedSystemZlib(f.root)).rejects.toThrow('ZLIB_LIBRARY_MODIFIED');
    expect(await readFile(f.library, 'utf8')).toBe('modified component');
    await expect(stat(join(f.metadata, 'zlib1g'))).resolves.toBeDefined();
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
