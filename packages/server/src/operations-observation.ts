import { lstat, opendir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { QueueObservation, StorageObservation } from '@personamarket/contracts';
import { createSystemQueue } from './outbox.js';

/** 只读采样；不返回私有文件名，不跟随链接，超出预算明确返回部分结果。 */
export async function inspectStorageUsage(
  root: string,
  limits: { maxEntries: number; maxMilliseconds: number } = {
    maxEntries: 100_000,
    maxMilliseconds: 2_000,
  },
): Promise<StorageObservation> {
  const checkedAt = new Date().toISOString(),
    started = performance.now();
  let files = 0,
    bytes = 0,
    entries = 0,
    partial = false;
  const pending = [{ path: root, depth: 0 }];
  try {
    if (
      !isAbsolute(root) ||
      !Number.isSafeInteger(limits.maxEntries) ||
      limits.maxEntries < 1 ||
      !Number.isFinite(limits.maxMilliseconds) ||
      limits.maxMilliseconds <= 0
    )
      throw new Error('INVALID_STORAGE_OBSERVATION');
    const stat = await lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('UNSAFE_STORAGE_ROOT');
    while (pending.length) {
      const current = pending.pop();
      if (!current) break;
      // 每一级均重查，避免跟随遍历期间被替换的目录链接
      const directory = await lstat(current.path);
      if (!directory.isDirectory() || directory.isSymbolicLink()) {
        partial = true;
        continue;
      }
      for await (const entry of await opendir(current.path)) {
        if (++entries > limits.maxEntries || performance.now() - started > limits.maxMilliseconds) {
          return { status: 'partial', checkedAt, files, bytes };
        }
        const path = join(current.path, entry.name);
        const item = await lstat(path);
        if (item.isSymbolicLink()) {
          partial = true;
          continue;
        }
        if (item.isDirectory()) {
          if (current.depth >= 8) partial = true;
          else pending.push({ path, depth: current.depth + 1 });
        } else if (item.isFile()) {
          if (!Number.isSafeInteger(bytes + item.size))
            return { status: 'partial', checkedAt, files, bytes };
          files++;
          bytes += item.size;
        } else partial = true;
      }
    }
    return { status: partial ? 'partial' : 'ready', checkedAt, files, bytes };
  } catch {
    return { status: 'unavailable', checkedAt, files: null, bytes: null };
  }
}

/** 仅访问配置队列的计数，不读取可能含地址、令牌或正文的任务数据与错误详情。 */
export async function inspectQueueUsage(redisUrl: string, name: string): Promise<QueueObservation> {
  const checkedAt = new Date().toISOString(),
    queue = createSystemQueue(redisUrl, name);
  try {
    await queue.waitUntilReady();
    const counts = await queue.getJobCounts('failed', 'waiting', 'active', 'delayed');
    return {
      status: 'ready',
      checkedAt,
      failed: counts['failed'] ?? 0,
      waiting: counts['waiting'] ?? 0,
      active: counts['active'] ?? 0,
      delayed: counts['delayed'] ?? 0,
    };
  } catch {
    return {
      status: 'unavailable',
      checkedAt,
      failed: null,
      waiting: null,
      active: null,
      delayed: null,
    };
  } finally {
    await queue.close();
  }
}
