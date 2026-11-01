import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { inspectQueueUsage, inspectStorageUsage } from '@personamarket/server';

const owned: string[] = [];
afterEach(async () => {
  // 路径直接来自本用例 mkdtemp，不接受外部输入
  for (const path of owned.splice(0)) {
    if (!resolve(path).startsWith(join(tmpdir(), 'pm-storage-observation-')))
      throw Error('拒绝清理非本测试创建的目录');
    await rm(path, { recursive: true, force: true });
  }
});
async function folder() {
  const path = await mkdtemp(join(tmpdir(), 'pm-storage-observation-'));
  owned.push(path);
  return path;
}
it('真实存储统计包含嵌套文件与零字节文件，不返回路径', async () => {
  const path = await folder();
  await mkdir(join(path, 'nested'));
  await writeFile(join(path, 'private-file'), '12345');
  await writeFile(join(path, 'nested', 'empty'), '');
  const result = await inspectStorageUsage(path);
  expect(result).toMatchObject({ status: 'ready', files: 2, bytes: 5 });
  expect(JSON.stringify(result)).not.toContain(path);
  expect(JSON.stringify(result)).not.toContain('private-file');
});
it('超过数量预算明确标记部分结果，缺失目录不冒充零用量', async () => {
  const path = await folder();
  await writeFile(join(path, 'one'), '1');
  await writeFile(join(path, 'two'), '22');
  expect(await inspectStorageUsage(path, { maxEntries: 1, maxMilliseconds: 2000 })).toMatchObject({
    status: 'partial',
    files: 1,
  });
  expect(await inspectStorageUsage(join(path, 'missing'))).toMatchObject({
    status: 'unavailable',
    files: null,
    bytes: null,
  });
});
it('不跟随目录链接或将链接根目录作为私有存储', async () => {
  const path = await folder(),
    outside = await folder();
  await writeFile(join(outside, 'secret'), 'outside');
  await symlink(outside, join(path, 'link'), 'junction');
  expect(await inspectStorageUsage(path)).toMatchObject({ status: 'partial', files: 0, bytes: 0 });
  expect(await inspectStorageUsage(join(path, 'link'))).toMatchObject({
    status: 'unavailable',
    files: null,
    bytes: null,
  });
});

it('队列连接真实失败时返回不可用和null，不将失败伪装成零任务', async () => {
  const listener = createServer();
  await new Promise<void>((done, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', done);
  });
  const address = listener.address();
  await new Promise<void>((done, reject) =>
    listener.close((error) => (error ? reject(error) : done())),
  );
  if (!address || typeof address === 'string') throw Error('缺少已释放的本机端口');
  expect(
    await inspectQueueUsage('redis://127.0.0.1:' + address.port + '/0', 'observation-unavailable'),
  ).toMatchObject({
    status: 'unavailable',
    failed: null,
    waiting: null,
    active: null,
    delayed: null,
  });
});
