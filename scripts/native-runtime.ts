import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import upstreamLock from '../tests/native/upstream-lock.json' with { type: 'json' };
export const root = fileURLToPath(new URL('../', import.meta.url));

export const lock = upstreamLock;
export const toolsImage =
  'alpine:3.24.3@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a';
export function docker(args: string[], input?: string) {
  const result = spawnSync('docker', args, {
    cwd: root,
    input,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 240_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(`原生验证 Docker ${args[0]} 失败：${result.stderr.slice(-3000)}`);
  return result.stdout.trim();
}
export async function source(name: keyof typeof lock) {
  const spec = lock[name];
  const cache = join(root, 'data/cache/upstream');
  mkdirSync(cache, { recursive: true, mode: 0o700 });
  const archive = join(cache, `${name}.tar.gz`);
  if (!existsSync(archive)) {
    const response = await fetch(spec.url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`无法获取 ${name} 固定版本源码`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 128 * 1024 * 1024) throw new Error('上游源码归档超过预算');
    writeFileSync(archive, bytes);
  }
  if (createHash('sha256').update(readFileSync(archive)).digest('hex') !== spec.sha256)
    throw new Error(`${name} 源码哈希不匹配`);
  const result = spawnSync('tar', ['-tzf', archive], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (
    result.status !== 0 ||
    result.stdout
      .trim()
      .split('\n')
      .some((entry) => {
        const path = entry.trim().replaceAll('\\', '/');
        return !path.startsWith(spec.directory + '/') || path.split('/').includes('..');
      })
  )
    throw new Error('上游归档路径不安全');
  // Fresh extraction prevents stale cache files from replacing or shadowing native modules.
  const destination = mkdtempSync(join(cache, name + '-'));
  const extracted = spawnSync('tar', ['-xzf', archive, '-C', destination], {
    windowsHide: true,
    timeout: 30_000,
  });
  if (extracted.status !== 0) throw new Error('上游源码解压失败');
  return join(destination, spec.directory);
}
