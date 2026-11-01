import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

export interface Storage {
  put(key: string, content: Uint8Array): Promise<void>;
  read(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

/** 默认项目 data/storage 私有目录；HTTP 访问必须另经归属和发布状态校验。 */
export class LocalStorage implements Storage {
  constructor(
    private readonly root: string,
    private readonly maxBytes = 5 * 1024 * 1024,
  ) {
    if (!isAbsolute(root)) throw new Error('存储根目录必须为绝对路径。');
  }
  private path(key: string) {
    if (!/^[a-f0-9]{32}(?:\.[a-z0-9]{1,8})?$/.test(key)) {
      throw new Error('无效的存储键。');
    }
    return join(this.root, key);
  }
  async put(key: string, content: Uint8Array) {
    const path = this.path(key);
    if (content.byteLength > this.maxBytes) throw new Error('文件超过存储上限。');
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await writeFile(path, content, { flag: 'wx', mode: 0o600 });
  }
  async read(key: string) {
    return readFile(this.path(key));
  }
  async delete(key: string) {
    await unlink(this.path(key));
  }
}
