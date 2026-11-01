import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const root = fileURLToPath(new URL('../../', import.meta.url));
const testsRoot = resolve(root, 'data/tests');
const migrationsRoot = fileURLToPath(
  new URL('../../packages/database/migrations/', import.meta.url),
);
const tagSchema = z.string().regex(/^\d{4}_[a-z0-9_]+$/u);

/** 仅在case自有data/tests目录生成精确迁移前缀；原SQL字节保持，不迁移、不覆盖或删除。 */
export async function prepareScopedMigrations(
  ownedRoot: string,
  targetTag: string,
): Promise<{ folder: string; count: number }> {
  const directory = resolve(ownedRoot),
    part = relative(testsRoot, directory);
  if (!part || isAbsolute(part) || part === '..' || part.startsWith('..' + sep))
    throw Error('迁移夹具必须位于case自有data/tests子目录');
  let cursor = root;
  for (const segment of ['', ...relative(root, directory).split(sep)]) {
    if (segment) cursor = join(cursor, segment);
    const entry = await lstat(cursor);
    if (!entry.isDirectory() || entry.isSymbolicLink())
      throw Error('迁移夹具目录不能越界或使用链接');
  }
  const tag = tagSchema.parse(targetTag);
  const journal = z
    .object({
      entries: z.array(
        z.object({ idx: z.number().int().nonnegative(), tag: tagSchema }).passthrough(),
      ),
    })
    .passthrough()
    .parse(JSON.parse(await readFile(join(migrationsRoot, 'meta/_journal.json'), 'utf8')));
  const index = journal.entries.findIndex((entry) => entry.tag === tag);
  if (index < 0) throw Error('不存在指定的真实迁移tag');
  const entries = journal.entries.slice(0, index + 1);
  if (entries.some((entry, position) => entry.idx !== position)) throw Error('迁移前缀索引不连续');
  const folder = join(directory, 'through-' + tag);
  await mkdir(folder, { mode: 0o700 });
  await mkdir(join(folder, 'meta'), { mode: 0o700 });
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }), {
    flag: 'wx',
    mode: 0o600,
  });
  for (const entry of entries) {
    const source = join(migrationsRoot, entry.tag + '.sql');
    const stat = await lstat(source);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('迁移SQL必须是仓库原文件');
    await writeFile(join(folder, entry.tag + '.sql'), await readFile(source), {
      flag: 'wx',
      mode: 0o600,
    });
  }
  return { folder, count: entries.length };
}
