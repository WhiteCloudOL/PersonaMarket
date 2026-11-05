import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as prettier from 'prettier';
import { root } from './runtime.mjs';
import { listSourceFiles } from './source-files.ts';

const mode = process.argv[2];
if (process.argv.length !== 3 || !['--check', '--write'].includes(mode))
  throw new Error('格式命令只支持 --check 或 --write');
let checked = 0;
let changed = 0;
for (const file of listSourceFiles(root)) {
  const path = join(root, file);
  const info = await prettier.getFileInfo(path, { ignorePath: join(root, '.prettierignore') });
  if (info.ignored || !info.inferredParser) continue;
  const options = {
    ...(await prettier.resolveConfig(path, { editorconfig: true })),
    filepath: path,
  };
  const original = readFileSync(path, 'utf8');
  checked++;
  if (mode === '--check') {
    if (await prettier.check(original, options)) continue;
    process.exitCode = 1;
  } else {
    const formatted = await prettier.format(original, options);
    if (formatted === original) continue;
    writeFileSync(path, formatted);
  }
  changed++;
  console.log(file);
}
console.log(
  `已检查 ${checked} 个源码文件，${mode === '--write' ? '已格式化' : '需要格式化'} ${changed} 个`,
);
