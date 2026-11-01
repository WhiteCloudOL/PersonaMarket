import { createTestDatabaseOwner, migrateDatabase } from '@personamarket/database';
import { createTestDatabase, dropTestDatabase } from './test-database.ts';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { reserveHttpOrigin } from './http-server.ts';
import { parseServerEnvironment } from '@personamarket/server';
import { environment, pnpm, root } from './runtime.mjs';
import { runBrowserStage, describeRunnerFailure } from './test-runner-failure.ts';
import { createE2eStorage } from './e2e-storage.ts';

async function execute(command, source) {
  const child = pnpm(command, source);
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}
async function browserOrigin() {
  return reserveHttpOrigin();
}

async function browserProjects(source, url, args, available = ['desktop', 'tablet', 'mobile']) {
  const requested = [];
  const filters = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--project') requested.push(args[++index]);
    else if (argument.startsWith('--project=')) requested.push(argument.slice(10));
    else filters.push(argument);
  }
  const projects = requested.length ? [...new Set(requested)] : available;
  if (projects.some((name) => !available.includes(name))) throw new Error('未知的浏览器测试项目');
  const reports = join(root, 'data/tests/playwright/blobs', randomUUID());
  mkdirSync(reports, { recursive: true });
  const owner = createTestDatabaseOwner(url);
  const suites = filters.some(
    (value) =>
      value.includes('.spec.') ||
      ['--grep', '-g', '--grep-invert'].includes(value) ||
      value.startsWith('--grep='),
  )
    ? [{ name: 'selected', files: [] }]
    : readdirSync(join(root, 'tests/e2e'))
        .filter((name) => name.endsWith('.spec.ts'))
        .sort()
        // CLI 文件过滤器按正则解释，Windows 的路径分隔符不能作为反斜杠传入
        .map((name) => ({ name: name.replace('.spec.ts', ''), files: ['tests/e2e/' + name] }));
  let result = 0;
  try {
    // 每个视口独立测试库和限流命名空间，保持真实生产限流与单 worker。
    for (const project of projects) {
      for (const suite of suites) {
        const name = 'pm_e2e_' + randomUUID().replaceAll('-', '') + '_test';
        const context = { project, suite: suite.name, database: name };
        let created = false;
        const storage = createE2eStorage(root);
        try {
          await runBrowserStage('create_database', context, () => createTestDatabase(owner, name));
          created = true;
          const isolated = new URL(url);
          isolated.pathname = '/' + name;
          const origin = await runBrowserStage('reserve_origin', context, browserOrigin);
          const code = await runBrowserStage('execute_browser', context, () =>
            execute(
              [
                'exec',
                'playwright',
                'test',
                ...filters,
                ...suite.files,
                '--project=' + project,
                '--reporter=list,blob',
              ],
              {
                ...source,
                TEST_DATABASE_URL: isolated.href,
                E2E_STORAGE_ROOT: storage.directory,
                PLAYWRIGHT_ORIGIN: origin,
                PLAYWRIGHT_NO_COPY_PROMPT: '1',
                PLAYWRIGHT_RESULTS_DIR: join(
                  root,
                  'data/tests/playwright/results',
                  project,
                  suite.name,
                ),
                PLAYWRIGHT_BLOB_OUTPUT_DIR: reports,
                PLAYWRIGHT_BLOB_OUTPUT_NAME: project + '-' + suite.name + '.zip',
                PWTEST_BLOB_DO_NOT_REMOVE: '1',
              },
            ),
          );
          if (code) {
            console.error(
              JSON.stringify({
                ...describeRunnerFailure('execute_browser', context, { code: 'EPLAYWRIGHT' }),
                exitCode: code,
              }),
            );
            result = code;
          }
        } finally {
          try {
            if (created)
              await runBrowserStage('drop_database', context, () => dropTestDatabase(owner, name));
          } finally {
            storage.cleanup();
          }
        }
      }
    }
    const merged = await runBrowserStage('merge_reports', {}, () =>
      execute(['exec', 'playwright', 'merge-reports', '--reporter=html', reports], {
        ...source,
        PLAYWRIGHT_HTML_OUTPUT_DIR: join(root, 'data/tests/playwright/report'),
        PLAYWRIGHT_HTML_OPEN: 'never',
      }),
    );
    return result || merged;
  } finally {
    await runBrowserStage('close_owner', {}, () => owner.close());
  }
}

try {
  const source = environment();
  const mode = process.argv[2];
  if (mode === 'migrate') {
    const url = source.MIGRATION_DATABASE_URL;
    if (!url || !['postgres:', 'postgresql:'].includes(new URL(url).protocol)) {
      throw new Error('缺少有效的 MIGRATION_DATABASE_URL。');
    }
    await migrateDatabase(url);
    console.log('版本化 SQL 迁移已完成。');
  } else {
    parseServerEnvironment(source);
    const url = source.TEST_DATABASE_URL;
    if (!url || !new URL(url).pathname.endsWith('_test'))
      throw new Error('必须显式配置以 _test 结尾的独立 TEST_DATABASE_URL。');
    const commands = {
      integration: [
        'exec',
        'vitest',
        'run',
        '--config',
        'vitest.integration.config.ts',
        ...process.argv.slice(3),
      ],
      e2e: ['exec', 'playwright', 'test', ...process.argv.slice(3)],
      remote: ['exec', 'tsx', 'scripts/check-remote-image.ts'],
      visual: ['exec', 'playwright', 'test', '--config=playwright.visual.config.ts'],
    };
    const command = commands[mode];
    if (!command) throw new Error('未知的执行模式。');
    process.exitCode =
      mode === 'visual'
        ? await browserProjects(
            source,
            url,
            [
              '--config=playwright.visual.config.ts',
              'tests/visual/ui-redesign.spec.ts',
              ...process.argv.slice(3),
            ],
            ['v360', 'v390', 'v430', 'v768', 'v1024', 'v1366', 'v1440', 'v1920'],
          )
        : mode === 'e2e'
          ? await browserProjects(source, url, process.argv.slice(3))
          : await execute(command, source);
  }
} catch (cause) {
  console.error(
    cause.message?.startsWith('环境配置无效')
      ? cause.message
      : '命令执行失败，请检查环境、依赖服务与数据库迁移。',
  );
  process.exitCode = 1;
}
