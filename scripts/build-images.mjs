import { spawn } from 'node:child_process';
import { environment, root } from './runtime.mjs';
import { buildEnvironment } from './build-provenance.mjs';
const services = ['postgres', 'redis', 'caddy', 'migrate', 'api', 'worker', 'web'];
const requested = process.argv.slice(2);
const selected = requested.length ? requested : services;
if (selected.some((service) => !services.includes(service))) throw new Error('未知的构建服务');
const env = buildEnvironment(environment());
// Compose 的 --parallel 不约束 Bake 内部的目标调度，逐服务调用保证本机资源上限
for (const service of [...new Set(selected)]) {
  console.log('串行构建容器：' + service);
  const child = spawn(
    'docker',
    [
      'compose',
      '--parallel',
      '1',
      '-f',
      'compose.yaml',
      '-f',
      'compose.dev.yaml',
      'build',
      service,
    ],
    { cwd: root, env, stdio: 'inherit', windowsHide: true },
  );
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (code !== 0) {
    process.exitCode = typeof code === 'number' ? code : 1;
    break;
  }
}
