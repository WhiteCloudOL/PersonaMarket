import { spawnSync } from 'node:child_process';
import { environment, root } from './runtime.mjs';

const mode = process.argv[2];
if (!['up', 'down'].includes(mode)) throw new Error('只支持 up / down。');
const env = environment();
if (mode === 'up') await import('./prepare-data.mjs');
for (const field of ['POSTGRES_PASSWORD', 'POSTGRES_APP_PASSWORD', 'REDIS_PASSWORD']) {
  if (!env[field] || env[field].startsWith('CHANGE_ME'))
    throw new Error(`请先运行 pnpm env:init 并配置 ${field}。`);
}
const args = [
  'compose',
  '-f',
  'compose.yaml',
  '-f',
  'compose.dev.yaml',
  ...(mode === 'up'
    ? ['up', '-d', '--build', '--wait', 'postgres', 'redis', 'mailpit']
    : ['stop', 'postgres', 'redis', 'mailpit']),
];
const result = spawnSync('docker', args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
process.exitCode = result.status ?? 1;
