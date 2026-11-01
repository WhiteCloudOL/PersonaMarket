import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@hey-api/openapi-ts';
import { format, resolveConfig } from 'prettier';
import { generateFetchOperations } from './openapi-fetch-generator.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const check = process.argv.includes('--check');
const cache = join(root, 'data/cache');
await mkdir(cache, { recursive: true });
const temporary = await mkdtemp(join(cache, 'personamarket-codegen-'));
if (
  dirname(resolve(temporary)) !== resolve(cache) ||
  !temporary.includes('personamarket-codegen-')
) {
  throw new Error('临时目录边界校验失败。');
}
const generated = join(temporary, 'generated');
const target = join(root, 'packages/api-client/src/generated');
async function list(directory: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(join(directory, prefix), { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? list(directory, join(prefix, entry.name))
        : Promise.resolve([join(prefix, entry.name)]),
    ),
  );
  return files.flat().sort();
}
try {
  const spec = join(temporary, 'openapi.json');
  execFileSync(process.execPath, ['apps/api/dist/generate-openapi.js', spec], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });
  await createClient({
    input: spec,
    output: {
      path: generated,
      tsConfigPath: join(root, 'packages/api-client/tsconfig.json'),
      module: { extension: '.js' },
    },
    plugins: ['@hey-api/typescript'],
  });
  const specContent: unknown = JSON.parse(await readFile(spec, 'utf8'));
  await writeFile(join(generated, 'operations.gen.ts'), generateFetchOperations(specContent));
  const options = await resolveConfig(join(root, '.prettierrc.json'));
  const outputs = new Map<string, string>();
  outputs.set(
    join(root, 'docs/openapi.json'),
    await format(await readFile(spec, 'utf8'), { ...options, parser: 'json' }),
  );
  for (const file of await list(generated)) {
    outputs.set(
      join(target, file),
      await format(await readFile(join(generated, file), 'utf8'), {
        ...options,
        parser: 'typescript',
      }),
    );
  }
  const mismatches: string[] = [];
  for (const [path, contents] of outputs) {
    if (check) {
      const actual = await readFile(path, 'utf8').catch(() => undefined);
      if (actual !== contents) mismatches.push(relative(root, path));
    } else {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, contents);
    }
  }
  const existing = await list(target).catch(() => []);
  for (const file of existing) {
    if (!outputs.has(join(target, file))) mismatches.push(`多余生成文件：${file}`);
  }
  if (mismatches.length) throw new Error(`OpenAPI / 客户端存在漂移：\n${mismatches.join('\n')}`);
  console.log(
    check ? 'OpenAPI 与生成客户端无漂移。' : '已从实际 Nest 路由生成 OpenAPI 与类型安全客户端。',
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
