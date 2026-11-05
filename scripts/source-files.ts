import { execFileSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { resolve } from 'node:path';

/** Git 枚举文件，避免格式工具为寻找源码而进入私有运行目录。 */
export function listSourceFiles(root: string) {
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  );
  return [...new Set(files.split('\0').filter(Boolean))].filter((file) => {
    try {
      return lstatSync(resolve(root, file)).isFile();
    } catch (cause) {
      if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return false;
      throw cause;
    }
  });
}
