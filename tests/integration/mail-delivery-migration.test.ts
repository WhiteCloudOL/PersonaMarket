import { randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { z } from 'zod';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, createTestDatabaseOwner, type Database } from '@personamarket/database';
import { enqueueMail } from '@personamarket/server';
import { createTestDatabase, dropTestDatabase } from '../../scripts/test-database.js';

const source = process.env['TEST_DATABASE_URL'];
if (!source || !new URL(source).pathname.endsWith('_test')) throw Error('只接受隔离迁移测试库');
const sourceUrl = new URL(source),
  administrator = createTestDatabaseOwner(sourceUrl.href);
const name = 'pm_it_' + randomUUID().replaceAll('-', '') + '_test';
const temporaryRoot = fileURLToPath(new URL('../../data/tests/', import.meta.url));
let database: Database | undefined,
  fixture: string | undefined,
  upgradedFixture: string | undefined,
  expectedMigrations = 0,
  created = false;
const target = new URL(sourceUrl);
target.pathname = '/' + name;
beforeAll(async () => {
  await createTestDatabase(administrator, name);
  created = true;
  database = createDatabase(target.href);
  await database.pool.query('GRANT USAGE ON SCHEMA public TO personamarket_app');
  await database.pool.query(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO personamarket_app',
  );
  await mkdir(temporaryRoot, { recursive: true });
  fixture = await mkdtemp(join(temporaryRoot, 'mail-delivery-upgrade-'));
  if (dirname(resolve(fixture)) !== resolve(temporaryRoot)) throw Error('迁移临时目录越界');
  const folder = fileURLToPath(new URL('../../packages/database/migrations/', import.meta.url));
  const journal = z
    .object({ entries: z.array(z.object({ idx: z.number(), tag: z.string() }).passthrough()) })
    .passthrough()
    .parse(JSON.parse(await readFile(join(folder, 'meta/_journal.json'), 'utf8')));
  const entries = journal.entries.filter((entry) => entry.idx <= 40);
  const upgradedEntries = journal.entries.filter((entry) => entry.idx <= 41);
  expect(upgradedEntries).toHaveLength(42);
  expect(upgradedEntries[41]?.tag).toBe('0041_mail_delivery_guard');
  expectedMigrations = upgradedEntries.length;
  expect(entries).toHaveLength(41);
  await mkdir(join(fixture, 'meta'));
  await writeFile(join(fixture, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
  for (const entry of entries)
    await copyFile(join(folder, entry.tag + '.sql'), join(fixture, entry.tag + '.sql'));
  // 本例只验0041；后续迁移允许增加其它默认设置，不能混入旧事实不变断言。
  upgradedFixture = join(fixture, 'through-0041');
  await mkdir(join(upgradedFixture, 'meta'), { recursive: true });
  await writeFile(
    join(upgradedFixture, 'meta/_journal.json'),
    JSON.stringify({ ...journal, entries: upgradedEntries }),
  );
  for (const entry of upgradedEntries)
    await copyFile(join(folder, entry.tag + '.sql'), join(upgradedFixture, entry.tag + '.sql'));
  await migrate(drizzle(database.pool), { migrationsFolder: fixture });
  const key = randomBytes(32).toString('hex');
  await database.db.transaction(async (tx) => {
    for (const suffix of ['pending', 'legacy-receipt'])
      await enqueueMail(tx, key, {
        to: suffix + '@migration-fixture.invalid',
        subject: '旧邮件升级夹具',
        text: '仅测试旧密文和状态原样保留，不投递SMTP',
      });
  });
  // 受控旧事实夹具，仅验证升级保持；不冒充SMTP实际送达的业务验收
  await database.pool.query(
    "INSERT INTO processed_events(consumer,event_id) SELECT 'auth-email',id FROM outbox_events WHERE topic='auth.email' ORDER BY id LIMIT 1",
  );
  await database.pool.query(
    "UPDATE site_settings SET value=jsonb_set(value,'{description}','\"升级前管理员自定义说明\"'::jsonb),revision=99 WHERE key='brand'",
  );
});
afterAll(async () => {
  try {
    await database?.close();
    if (created) {
      if (!/^pm_it_[a-f0-9]{32}_test$/u.test(name)) throw Error('迁移测试库归属不符');
      await dropTestDatabase(administrator, name);
    }
    if (fixture) {
      if (dirname(resolve(fixture)) !== resolve(temporaryRoot)) throw Error('拒绝清理越界临时目录');
      await rm(fixture, { recursive: true });
    }
  } finally {
    await administrator.close();
  }
});

it('0041邮件迁移精确41→42保留旧密文、回执和全部设置，建立保护约束且重复无变化', async () => {
  const migrationsFolder = upgradedFixture;
  if (!database || !migrationsFolder) throw Error('缺少隔离旧库或精确42迁移夹具');
  async function facts() {
    if (!database) throw Error('缺少隔离旧库');
    return {
      outbox: (await database.pool.query('SELECT * FROM outbox_events ORDER BY id')).rows,
      receipts: (
        await database.pool.query('SELECT * FROM processed_events ORDER BY consumer,event_id')
      ).rows,
      settings: (await database.pool.query('SELECT * FROM site_settings ORDER BY key')).rows,
      oldMigrations: (
        await database.pool.query(
          'SELECT * FROM drizzle.__drizzle_migrations WHERE id<=41 ORDER BY id',
        )
      ).rows,
    };
  }
  const before = await facts();
  await migrate(drizzle(database.pool), { migrationsFolder });
  expect(await facts()).toEqual(before);
  expect((await database.pool.query('SELECT * FROM mail_deliveries')).rowCount).toBe(0);
  expect((await database.pool.query('SELECT * FROM drizzle.__drizzle_migrations')).rowCount).toBe(
    expectedMigrations,
  );
  expect(expectedMigrations).toBe(42);
  const migrated = (
    await database.pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')
  ).rows;
  expect(migrated.slice(0, 41)).toEqual(before.oldMigrations);
  expect(
    (
      await database.pool.query(
        "SELECT count(*)::int AS amount FROM pg_trigger WHERE tgname IN ('mail_delivery_transition_guard','mail_delivery_delete_guard','started_mail_payload_guard')",
      )
    ).rows[0]?.amount,
  ).toBe(3);
  expect(
    (
      await database.pool.query(
        "SELECT has_table_privilege('personamarket_app','public.mail_deliveries','DELETE') AS allowed",
      )
    ).rows[0]?.allowed,
  ).toBe(false);
  await migrate(drizzle(database.pool), { migrationsFolder });
  expect(await facts()).toEqual(before);
  expect((await database.pool.query('SELECT * FROM mail_deliveries')).rowCount).toBe(0);
  expect(
    (await database.pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows,
  ).toEqual(migrated);
});
