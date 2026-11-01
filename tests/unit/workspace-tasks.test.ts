import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { z } from 'zod';

it('冷启动类型检查先生成根工程测试所需的 API 公共导出', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const graph = z
    .object({ tasks: z.array(z.object({ taskId: z.string(), dependencies: z.array(z.string()) })) })
    .parse(
      JSON.parse(
        execFileSync(
          process.execPath,
          ['node_modules/turbo/bin/turbo', 'run', 'typecheck', '--dry=json'],
          { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 15_000 },
        ),
      ),
    );
  const apiCheck = graph.tasks.find((task) => task.taskId === '@personamarket/api#typecheck');
  expect(apiCheck?.dependencies).toContain('@personamarket/api#build');
  expect(graph.tasks.some((task) => task.taskId === '@personamarket/api#build')).toBe(true);
});
