import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { marketPersonaJsonSchema } from '@personamarket/contracts';

const args = process.argv.slice(2);
if (args.some((value) => value !== '--check') || args.length > 1)
  throw new Error('仅支持 --check 参数');
const target = new URL('../packages/contracts/schema/persona-v1.schema.json', import.meta.url);
const path = fileURLToPath(target);
const output = await format(JSON.stringify(marketPersonaJsonSchema()), {
  ...(await resolveConfig(path)),
  parser: 'json',
});
if (args.includes('--check')) {
  const current = await readFile(target, 'utf8').catch(() => undefined);
  if (current !== output)
    throw new Error('人设通用格式JSON Schema已漂移，请执行 pnpm formats:generate');
  console.log('人设通用格式JSON Schema与共享契约一致');
} else {
  await mkdir(new URL('../packages/contracts/schema/', import.meta.url), { recursive: true });
  await writeFile(target, output);
  console.log('已生成版本1人设通用格式JSON Schema');
}
