import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';
import { environment, root } from './runtime.mjs';

const data = resolve(root, 'data');
for (const files of [['compose.yaml'], ['compose.yaml', 'compose.dev.yaml']]) {
  const result = spawnSync(
    'docker',
    ['compose', ...files.flatMap((file) => ['-f', file]), 'config', '--format', 'json'],
    {
      cwd: root,
      env: environment(),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15_000,
    },
  );
  if (result.status !== 0) throw new Error('Compose 配置读取失败，请核对 .env 与 Docker。');
  const config = JSON.parse(result.stdout);
  assert.equal(Object.keys(config.volumes ?? {}).length, 0, '禁止定义 Docker 数据卷。');
  let count = 0;
  for (const [name, service] of Object.entries(config.services)) {
    for (const mount of service.volumes ?? []) {
      assert.equal(mount.type, 'bind', name + ' 只能使用目录绑定。');
      if (mount.read_only) continue;
      const path = relative(data, resolve(mount.source));
      assert.ok(
        path && !isAbsolute(path) && !path.startsWith('..'),
        name + ' 的数据目录必须在 data/ 下。',
      );
      count++;
    }
  }
  assert.equal(
    count,
    files.length === 1 ? 10 : 12,
    '持久数据挂载数量发生变化，请审查目录与检查规则。',
  );
}
console.log('数据布局通过：开发与生产 Compose 均无命名卷，全部持久数据绑定到项目 data/。');
