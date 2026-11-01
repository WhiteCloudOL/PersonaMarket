import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './runtime.mjs';

const folders = [
  'postgres',
  'redis',
  'mailpit',
  'storage',
  'caddy/data',
  'caddy/config',
  'backups',
  'cache',
  'tests',
];
const directory = join(root, 'data');
for (const path of ['', ...folders]) {
  let current = directory;
  for (const part of path.split('/').filter(Boolean)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw new Error('data 目录不能通过符号链接指向仓库外。');
    current = join(current, part);
  }
  if (existsSync(current) && lstatSync(current).isSymbolicLink())
    throw new Error('data 子目录不能是符号链接。');
  mkdirSync(current, { recursive: true, mode: 0o700 });
}
console.log('项目 data/ 目录已准备，已有文件保持原样。');
