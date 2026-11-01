import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { z } from 'zod';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, createTestDatabaseOwner, type Database } from '@personamarket/database';
import { createAdministrator, enqueueMail } from '@personamarket/server';
import { createTestDatabase, dropTestDatabase } from '../../scripts/test-database.js';
import { prepareScopedMigrations } from '../fixtures/scoped-migrations.js';

const source = process.env['TEST_DATABASE_URL'];
if (!source || !new URL(source).pathname.endsWith('_test')) throw Error('只允许隔离迁移测试库');
const administrator = createTestDatabaseOwner(source),
  name = 'pm_it_' + randomUUID().replaceAll('-', '') + '_test';
const target = new URL(source);
target.pathname = '/' + name;
const temporaryRoot = fileURLToPath(new URL('../../data/tests/', import.meta.url));
let database: Database | undefined,
  fixture: string | undefined,
  created = false,
  expectedMigrations = 0;
beforeAll(async () => {
  await createTestDatabase(administrator, name);
  created = true;
  database = createDatabase(target.href);
  await database.pool.query('GRANT USAGE ON SCHEMA public TO personamarket_app');
  await database.pool.query(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO personamarket_app',
  );
  await mkdir(temporaryRoot, { recursive: true });
  fixture = await mkdtemp(join(temporaryRoot, 'task-retry-upgrade-'));
  if (dirname(resolve(fixture)) !== resolve(temporaryRoot)) throw Error('迁移临时目录越界');
  const folder = fileURLToPath(new URL('../../packages/database/migrations/', import.meta.url));
  const journal = z
    .object({ entries: z.array(z.object({ idx: z.number(), tag: z.string() }).passthrough()) })
    .passthrough()
    .parse(JSON.parse(await readFile(join(folder, 'meta/_journal.json'), 'utf8')));
  const entries = journal.entries.filter((entry) => entry.idx <= 41);
  expectedMigrations = 43;
  expect(entries).toHaveLength(42);
  await mkdir(join(fixture, 'meta'));
  await writeFile(join(fixture, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
  for (const entry of entries)
    await copyFile(join(folder, entry.tag + '.sql'), join(fixture, entry.tag + '.sql'));
  await migrate(drizzle(database.pool), { migrationsFolder: fixture });
  const owner = await createAdministrator(database, {
    username: 'upgrade_owner',
    email: 'upgrade_owner@fixture.invalid',
    password: 'Owned upgrade fixture passphrase 2026',
  });
  await database.pool.query(
    "INSERT INTO asset_jobs(owner_id,source_url,status,error_code) VALUES($1,'https://upgrade-fixture.invalid/private-image.png','failed','IMAGE_IMPORT_FAILED')",
    [owner.id],
  );
  await database.db.transaction((tx) =>
    enqueueMail(tx, 'c'.repeat(64), {
      to: 'owned-upgrade@fixture.invalid',
      subject: '只保留升级前密文',
      text: '隔离升级夹具，不连接SMTP',
    }),
  );
  await database.pool.query(
    "UPDATE site_settings SET value=jsonb_set(value,'{description}','\"管理员自定义内容必须保留\"'::jsonb),revision=91 WHERE key='brand'",
  );
});
afterAll(async () => {
  try {
    await database?.close();
    if (created) await dropTestDatabase(administrator, name);
    if (fixture) {
      if (dirname(resolve(fixture)) !== resolve(temporaryRoot)) throw Error('拒绝清理越界临时目录');
      await rm(fixture, { recursive: true });
    }
  } finally {
    await administrator.close();
  }
});
it('旧42迁移升级及重复升级逐字段保留账号、失败任务、邮件密文、旧迁移和管理员自定义设置', async () => {
  if (!database) throw Error('缺少隔离旧库');
  async function facts() {
    if (!database) throw Error('缺少隔离旧库');
    return {
      users: (await database.pool.query('SELECT * FROM users ORDER BY id')).rows,
      jobs: (await database.pool.query('SELECT * FROM asset_jobs ORDER BY id')).rows,
      outbox: (await database.pool.query('SELECT * FROM outbox_events ORDER BY id')).rows,
      receipts: (
        await database.pool.query('SELECT * FROM processed_events ORDER BY consumer,event_id')
      ).rows,
      mail: (await database.pool.query('SELECT * FROM mail_deliveries ORDER BY event_id')).rows,
      settings: (await database.pool.query('SELECT * FROM site_settings ORDER BY key')).rows,
      oldMigrations: (
        await database.pool.query(
          'SELECT * FROM drizzle.__drizzle_migrations WHERE id<=42 ORDER BY id',
        )
      ).rows,
    };
  }
  const before = await facts();
  if (!fixture) throw Error('缺少自有迁移目录');
  const migrationTarget = await prepareScopedMigrations(fixture, '0042_admin_task_retries');
  expect(migrationTarget.count).toBe(expectedMigrations);
  await migrate(drizzle(database.pool), { migrationsFolder: migrationTarget.folder });
  expect(await facts()).toEqual(before);
  expect((await database.pool.query('SELECT * FROM admin_task_retries')).rowCount).toBe(0);
  expect((await database.pool.query('SELECT * FROM drizzle.__drizzle_migrations')).rowCount).toBe(
    expectedMigrations,
  );
  expect(
    (
      await database.pool.query(
        "SELECT count(*)::int AS amount FROM pg_trigger WHERE tgname IN ('admin_task_retry_update_guard','admin_task_retry_delete_guard')",
      )
    ).rows,
  ).toEqual([{ amount: 2 }]);
  expect(
    (
      await database.pool.query(
        "SELECT has_table_privilege('personamarket_app','admin_task_retries','UPDATE') AS can_update,has_table_privilege('personamarket_app','admin_task_retries','DELETE') AS can_delete",
      )
    ).rows,
  ).toEqual([{ can_update: false, can_delete: false }]);
  await migrate(drizzle(database.pool), { migrationsFolder: migrationTarget.folder });
  expect(await facts()).toEqual(before);
});
