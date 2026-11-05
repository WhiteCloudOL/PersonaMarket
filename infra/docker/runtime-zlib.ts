import { createHash } from 'node:crypto';
import { lstat, readFile, readlink, realpath, readdir, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';

/** 删除有包清单和校验和证明的闲置库，保留许可文件和其他组件。 */
export async function removeUnusedSystemZlib(root: string) {
  const directory = await realpath(root);
  const metadata = join(directory, 'var/lib/dpkg/status.d');
  const status = await readFile(join(metadata, 'zlib1g'), 'utf8');
  const version = /^Version: (.+)$/mu.exec(status)?.[1];
  if (!/^Package: zlib1g$/mu.test(status) || !version) throw Error('ZLIB_PACKAGE_UNVERIFIABLE');
  const manifest = await readFile(join(metadata, 'zlib1g.md5sums'), 'utf8');
  const entries = manifest
    .trim()
    .split('\n')
    .map((line) => {
      const match = /^([a-f0-9]{32})\s+(.+)$/u.exec(line);
      const checksum = match?.[1];
      const path = match?.[2];
      if (
        !checksum ||
        !path ||
        path.includes('\\') ||
        posix.isAbsolute(path) ||
        path.split('/').includes('..') ||
        posix.normalize(path) !== path
      )
        throw Error('ZLIB_MANIFEST_UNSAFE');
      return { path, checksum };
    });
  const libraries = entries.filter(({ path }) =>
    /^usr\/lib\/[^/]+\/libz\.so\.1(?:\.\d+)+$/u.test(path),
  );
  if (libraries.length !== 1) throw Error('ZLIB_LIBRARY_UNVERIFIABLE');
  const owned: string[] = [];
  for (const library of libraries) {
    const path = resolve(directory, library.path);
    const parent = await realpath(dirname(path));
    const part = relative(directory, parent);
    if (isAbsolute(part) || part === '..' || part.startsWith('..' + sep))
      throw Error('ZLIB_PATH_ESCAPES_ROOT');
    if (!(await lstat(path)).isFile()) throw Error('ZLIB_LIBRARY_UNVERIFIABLE');
    if (
      createHash('md5')
        .update(await readFile(path))
        .digest('hex') !== library.checksum
    )
      throw Error('ZLIB_LIBRARY_MODIFIED');
    owned.push(path);
    const soname = join(parent, 'libz.so.1');
    const alias = await lstat(soname).catch((cause: unknown) => {
      if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return null;
      throw cause;
    });
    if (alias) {
      if (!alias.isSymbolicLink() || (await readlink(soname)) !== basename(path))
        throw Error('ZLIB_SONAME_UNVERIFIABLE');
      owned.push(soname);
    }
    const unexpected = (await readdir(parent)).filter(
      (name) => /^libz\.so(?:\.|$)/u.test(name) && !owned.some((file) => basename(file) === name),
    );
    if (unexpected.length) throw Error('ZLIB_EXTRA_LIBRARY_UNVERIFIABLE');
  }
  owned.push(join(metadata, 'zlib1g'), join(metadata, 'zlib1g.md5sums'));
  for (const path of owned) await unlink(path);
  return { version, removedPaths: owned };
}
