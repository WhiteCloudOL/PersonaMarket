import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const root = fileURLToPath(new URL('../', import.meta.url));
export function environment() {
  const path = new URL('../.env', import.meta.url);
  return { ...(existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {}), ...process.env };
}
export function pnpm(args, env = process.env, sync = false) {
  const executable = process.env.npm_execpath;
  if (!executable || !existsSync(executable)) throw new Error('请通过 pnpm 运行此命令。');
  const options = { cwd: root, env, stdio: 'inherit', windowsHide: true };
  return sync
    ? spawnSync(process.execPath, [executable, ...args], options)
    : spawn(process.execPath, [executable, ...args], options);
}

export function supervise(children) {
  let closing = false;
  function close() {
    if (closing) return;
    closing = true;
    for (const child of children) child.kill('SIGTERM');
  }
  for (const child of children) {
    child.on('error', () => {
      process.exitCode = 1;
      close();
    });
    child.on('exit', (code) => {
      if (!closing) {
        process.exitCode = code ?? 1;
        close();
      }
    });
  }
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}
