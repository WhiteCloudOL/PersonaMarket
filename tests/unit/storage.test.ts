import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const temporaryRoot = fileURLToPath(new URL('../../data/tests/', import.meta.url));
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalStorage } from '@personamarket/server';

const directories: string[] = [];
async function storage(maxBytes = 1024) {
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(join(temporaryRoot, 'personamarket-storage-'));
  directories.push(directory);
  return new LocalStorage(directory, maxBytes);
}
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (dirname(resolve(directory)) !== resolve(temporaryRoot)) throw new Error('临时目录越界。');
    await rm(directory, { recursive: true, force: true });
  }
});
describe('私有本地存储边界', () => {
  it('字节可持久读取，不覆盖已有对象，显式删除后不可读取', async () => {
    const target = await storage();
    const key = randomUUID().replaceAll('-', '') + '.txt';
    const bytes = new TextEncoder().encode('私有内容');
    await target.put(key, bytes);
    expect(await target.read(key)).toEqual(Buffer.from(bytes));
    await expect(target.put(key, bytes)).rejects.toMatchObject({ code: 'EEXIST' });
    await target.delete(key);
    await expect(target.read(key)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('拒绝路径穿越、相对根目录与超限内容', async () => {
    expect(() => new LocalStorage('./relative')).toThrow('绝对路径');
    const target = await storage(3);
    for (const key of ['../secret', '/etc/passwd', '..\\secret', 'https://example.com']) {
      await expect(target.read(key)).rejects.toThrow('无效的存储键');
    }
    await expect(target.put(randomUUID().replaceAll('-', ''), new Uint8Array(4))).rejects.toThrow(
      '存储上限',
    );
  });
});
