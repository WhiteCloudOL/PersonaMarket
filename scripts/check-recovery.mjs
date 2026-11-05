import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { environment, root } from './runtime.mjs';

// 仅针对本仓库本地开发 Compose，隔离恢复目录必须位于 data/tests。
const env = environment();
const toolsImage =
  'alpine:3.24.3@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a';
if (env.NODE_ENV !== 'development') throw new Error('恢复冒烟检查仅允许本地 development 配置。');
const composeArgs = ['compose', '-f', 'compose.yaml', '-f', 'compose.dev.yaml'];
function docker(args, input) {
  const result = spawnSync('docker', args, {
    cwd: root,
    env,
    input,
    windowsHide: true,
    timeout: 180_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(`Docker 子命令失败：${args[0]}（输出未回显，防止泄密）。`);
  return result.stdout;
}
const compose = (args, input) => docker([...composeArgs, ...args], input);
const sql = (database, statement) =>
  compose([
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'personamarket_owner',
    '-d',
    database,
    '-tA',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    statement,
  ])
    .toString()
    .trim();
const id = randomUUID().replaceAll('-', '');
const database = `pm_recovery_${id}_test`;
if (!/^pm_recovery_[a-f0-9]{32}_test$/.test(database)) throw new Error('隔离资源名称无效。');
const directory = join(root, 'data', 'backups', 'recovery', id);
const restoreDirectory = resolve(root, 'data', 'tests', 'recovery', id);
const restoreRelative = relative(resolve(root, 'data', 'tests'), restoreDirectory);
if (
  isAbsolute(restoreRelative) ||
  restoreRelative.startsWith('..') ||
  !restoreRelative.endsWith(id)
)
  throw new Error('恢复目录越界。');
mkdirSync(directory, { recursive: true, mode: 0o700 });
mkdirSync(join(root, '.development/evidence'), { recursive: true });
mkdirSync(restoreDirectory, { recursive: true, mode: 0o700 });
const key = `${id}.txt`;
const content = randomBytes(64).toString('hex');
const digest = createHash('sha256').update(content).digest('hex');
const storageCode = `import { LocalStorage } from '@personamarket/server'; const storage = new LocalStorage(process.env.STORAGE_ROOT);`;
const redisCode = `import { createClient } from 'redis'; const client = createClient({url:process.env.REDIS_URL}); client.on('error',()=>{}); await client.connect();`;
let createdDatabase = false;
let paused = false;
let restoreContainerOwned = false;
function restoreOwner(owner) {
  docker([
    'run',
    '--rm',
    '--network',
    'none',
    '--user',
    '0:0',
    '--cap-drop',
    'ALL',
    '--cap-add',
    'CHOWN',
    '--cap-add',
    'DAC_OVERRIDE',
    '--security-opt',
    'no-new-privileges:true',
    '--mount',
    `type=bind,src=${restoreDirectory},dst=/restore`,
    toolsImage,
    'chown',
    '-R',
    owner,
    '/restore',
  ]);
}
try {
  const before = sql(
    'personamarket',
    "SELECT jsonb_build_object('value', value, 'revision', revision)::text FROM site_settings WHERE key = 'brand'",
  );
  assert.ok(before);
  compose([
    'exec',
    '-T',
    'api',
    'node',
    '--input-type=module',
    '-e',
    `${storageCode} await storage.put('${key}', Buffer.from('${content}'));`,
  ]);
  compose([
    'exec',
    '-T',
    'worker',
    'node',
    '--input-type=module',
    '-e',
    `${redisCode} await client.set('recovery:${id}', '${id}', {EX:600}); await client.quit();`,
  ]);
  compose(['stop', 'web', 'api', 'worker']);
  paused = true;
  const dump = compose([
    'exec',
    '-T',
    'postgres',
    'pg_dump',
    '-U',
    'personamarket_owner',
    '-d',
    'personamarket',
    '--format=custom',
    '--no-owner',
  ]);
  writeFileSync(join(directory, 'database.dump'), dump, { mode: 0o600 });
  // 暂停业务写进程后，只归档本次创建的存储探针；不复制或公开其他私有文件。
  const archive = docker([
    'run',
    '--rm',
    '--mount',
    `type=bind,src=${join(root, 'data', 'storage')},dst=/data/storage,readonly`,
    '--entrypoint',
    'tar',
    toolsImage,
    '-C',
    '/data/storage',
    '-cf',
    '-',
    key,
  ]);
  writeFileSync(join(directory, 'storage-probe.tar'), archive, { mode: 0o600 });
  sql('postgres', `CREATE DATABASE "${database}"`);
  createdDatabase = true;
  compose(
    [
      'exec',
      '-T',
      'postgres',
      'pg_restore',
      '-U',
      'personamarket_owner',
      '-d',
      database,
      '--no-owner',
      '--exit-on-error',
    ],
    dump,
  );
  assert.equal(
    sql(
      database,
      "SELECT jsonb_build_object('value', value, 'revision', revision)::text FROM site_settings WHERE key = 'brand'",
    ),
    before,
  );
  assert.equal(
    sql(database, 'SELECT count(*) FROM drizzle.__drizzle_migrations'),
    sql('personamarket', 'SELECT count(*) FROM drizzle.__drizzle_migrations'),
  );
  const guardPrivilege =
    "SELECT coalesce(has_table_privilege('personamarket_app', to_regclass('public.auth_admin_guard'), 'UPDATE'), false)";
  assert.equal(
    sql(database, guardPrivilege),
    sql('personamarket', guardPrivilege),
    '恢复不得扩大应用账户对认证保护表的权限',
  );
  assert.equal(sql(database, guardPrivilege), 'f');
  const guardFunctionPrivilege =
    "SELECT coalesce(has_function_privilege('personamarket_app', to_regprocedure('public.protect_last_active_admin()'), 'EXECUTE'), false)";
  assert.equal(sql(database, guardFunctionPrivilege), sql('personamarket', guardFunctionPrivilege));
  assert.equal(sql(database, guardFunctionPrivilege), 'f');
  docker(
    [
      'run',
      '--rm',
      '-i',
      '--user',
      '0',
      '--mount',
      `type=bind,src=${restoreDirectory},dst=/restore`,
      '--entrypoint',
      'tar',
      toolsImage,
      '-C',
      '/restore',
      '-xf',
      '-',
    ],
    archive,
  );
  // Linux runner 与应用 UID 不同；保持 0700，并让真实非 root 应用读取恢复探针。
  restoreContainerOwned = true;
  restoreOwner('1000:1000');
  const restored = docker([
    'run',
    '--rm',
    '--mount',
    `type=bind,src=${restoreDirectory},dst=/restore,readonly`,
    '--entrypoint',
    'node',
    'personamarket-api:0.0.0',
    '--input-type=module',
    '-e',
    `import{readFileSync}from'node:fs';import{createHash}from'node:crypto';console.log(createHash('sha256').update(readFileSync('/restore/${key}')).digest('hex'));`,
  ])
    .toString()
    .trim();
  assert.equal(restored, digest);
  compose(['restart', 'postgres', 'redis']);
  compose(['up', '-d', '--wait']);
  paused = false;
  assert.equal(
    sql(
      'personamarket',
      "SELECT jsonb_build_object('value', value, 'revision', revision)::text FROM site_settings WHERE key = 'brand'",
    ),
    before,
  );
  const persisted = compose([
    'exec',
    '-T',
    'api',
    'node',
    '--input-type=module',
    '-e',
    `${storageCode} console.log((await storage.read('${key}')).toString());`,
  ])
    .toString()
    .trim();
  assert.equal(persisted, content);
  const redisPersisted = compose([
    'exec',
    '-T',
    'worker',
    'node',
    '--input-type=module',
    '-e',
    `${redisCode} console.log(await client.get('recovery:${id}')); await client.del('recovery:${id}'); await client.quit();`,
  ])
    .toString()
    .trim();
  assert.equal(redisPersisted, id);
  compose([
    'exec',
    '-T',
    'api',
    'node',
    '--input-type=module',
    '-e',
    `${storageCode} await storage.delete('${key}');`,
  ]);
  writeFileSync(
    join(root, '.development/evidence/recovery.json'),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        databaseDumpRestore: 'passed',
        migrationJournal: 'preserved',
        authenticationGuardAcl: 'preserved',
        privateStorageArchiveRestore: 'passed',
        postgresRedisAndStorageRestartPersistence: 'passed',
        sourceDatabaseRestoredOver: false,
        scope: 'local database and private-file probe; not a full production backup drill',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    '本地恢复检查通过：隔离库恢复、迁移记录、私有文件恢复与 PostgreSQL / Redis / 文件重启持久化。',
  );
} finally {
  if (restoreContainerOwned)
    restoreOwner(`${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`);
  if (paused) compose(['up', '-d', '--wait']);
  if (createdDatabase) sql('postgres', `DROP DATABASE "${database}"`);
  rmSync(restoreDirectory, { recursive: true, force: true });
}
