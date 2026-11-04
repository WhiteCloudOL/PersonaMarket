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
function compose(args) {
  const result = spawnSync(
    'docker',
    ['compose', '--parallel', '1', '-f', 'compose.yaml', '-f', 'compose.dev.yaml', ...args],
    { cwd: root, env, stdio: 'inherit', windowsHide: true },
  );
  if (result.error) console.error(result.error.message);
  return result.status ?? 1;
}

if (mode === 'up') {
  // Compose 的 --parallel 不限制同一次 Bake 构建中的目标；data-init 与 Redis 共用镜像。
  for (const service of ['postgres', 'redis']) {
    const code = compose(['build', service]);
    if (code !== 0) process.exit(code);
  }
  process.exitCode = compose(['up', '-d', '--no-build', '--wait', ...services]);
} else {
  process.exitCode = compose(['stop', ...services]);
}
