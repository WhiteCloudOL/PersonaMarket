import { spawnSync } from 'node:child_process';
import { environment, root } from './runtime.mjs';

const [mode, ...options] = process.argv.slice(2);
if (!['up', 'down'].includes(mode)) throw new Error('只支持 up / down。');
if (options.length > 1 || options.some((option) => option !== '--base-only')) {
  throw new Error('只支持可选参数 --base-only。');
}
const services = options.includes('--base-only')
  ? ['postgres', 'redis']
  : ['postgres', 'redis', 'mailpit'];
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
    ? ['--parallel', '1', 'up', '-d', '--build', '--wait', ...services]
    : ['stop', ...services]),
];
const result = spawnSync('docker', args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
process.exitCode = result.status ?? 1;
