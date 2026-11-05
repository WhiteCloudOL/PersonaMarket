import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, createTestDatabaseOwner, type Database } from '@personamarket/database';
import { seedUpgradeAdministrator } from '../fixtures/upgrade-administrator.js';
import { emptyPersonaDraft } from '@personamarket/contracts';
import { createTestDatabase, dropTestDatabase } from '../../scripts/test-database.js';
import { captureTableShape, tableFingerprints } from '../fixtures/table-fingerprints.js';
import { prepareScopedMigrations } from '../fixtures/scoped-migrations.js';

it('通知迁移保留旧表、Outbox和举报数据，新表为空，应用不能删除通知', async () => {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test'))
    throw new Error('必须使用真实隔离测试库');
  const owner = createTestDatabaseOwner(source),
    name = 'pm_it_' + randomUUID().replaceAll('-', '') + '_test';
  const temporaryRoot = fileURLToPath(new URL('../../data/tests/', import.meta.url));
  let database: Database | undefined,
    fixture: string | undefined,
    created = false;
  try {
    await createTestDatabase(owner, name);
    created = true;
    const url = new URL(source);
    url.pathname = '/' + name;
    database = createDatabase(url.href);
    await database.pool.query('GRANT USAGE ON SCHEMA public TO personamarket_app');
    await database.pool.query(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO personamarket_app',
    );
    const folder = fileURLToPath(new URL('../../packages/database/migrations/', import.meta.url));
    const journal = z
      .object({ entries: z.array(z.object({ idx: z.number(), tag: z.string() }).passthrough()) })
      .passthrough()
      .parse(JSON.parse(await readFile(join(folder, 'meta/_journal.json'), 'utf8')));
    const cutoff = journal.entries.findIndex((entry) => entry.tag === '0034_notifications');
    expect(cutoff).toBe(34);
    const previous = journal.entries.slice(0, cutoff);
    await mkdir(temporaryRoot, { recursive: true });
    fixture = await mkdtemp(join(temporaryRoot, 'notifications-schema-'));
    if (dirname(resolve(fixture)) !== resolve(temporaryRoot)) throw new Error('测试目录越界');
    await mkdir(join(fixture, 'meta'));
    await writeFile(
      join(fixture, 'meta/_journal.json'),
      JSON.stringify({ ...journal, entries: previous }),
    );
    for (const entry of previous)
      await writeFile(
        join(fixture, entry.tag + '.sql'),
        await readFile(join(folder, entry.tag + '.sql')),
      );
    await migrate(drizzle(database.pool), { migrationsFolder: fixture });
    const username = 'report_' + randomUUID().replaceAll('-', '').slice(0, 10);
    await seedUpgradeAdministrator(database, {
      username,
      email: username + '@fixture.invalid',
      password: 'Report migration fixture passphrase 2026',
    });
    const user = (
      await database.pool.query<{ id: string }>('SELECT id FROM users WHERE username=$1', [
        username,
      ])
    ).rows[0];
    if (!user) throw new Error('缺少隔离测试管理员');
    const personaId = randomUUID();
    await database.pool.query("INSERT INTO personas(id,owner_id,platform) VALUES($1,$2,'maibot')", [
      personaId,
      user.id,
    ]);
    await database.pool.query('INSERT INTO persona_drafts(persona_id,payload) VALUES($1,$2)', [
      personaId,
      emptyPersonaDraft('maibot', '通知迁移不能改写私有作品'),
    ]);
    const shape = await captureTableShape(database),
      before = await tableFingerprints(database, shape);
    const target = await prepareScopedMigrations(fixture, '0034_notifications');
    expect(target.count).toBe(35);
    await migrate(drizzle(database.pool), { migrationsFolder: target.folder });
    expect(await tableFingerprints(database, shape)).toEqual(before);
    expect((await database.pool.query('SELECT id FROM notifications')).rows).toEqual([]);
    const permissions = await database.pool.query<{
      table: string;
      update: boolean;
      delete: boolean;
      insert: boolean;
      select: boolean;
    }>(
      `SELECT t AS "table",has_table_privilege('personamarket_app',t,'UPDATE') AS update,has_table_privilege('personamarket_app',t,'DELETE') AS delete,
       has_table_privilege('personamarket_app',t,'INSERT') AS insert,has_table_privilege('personamarket_app',t,'SELECT') AS select FROM unnest(ARRAY['notifications']) t`,
    );
    expect(permissions.rows).toEqual([
      { table: 'notifications', update: true, delete: false, insert: true, select: true },
    ]);
    const allShape = await captureTableShape(database),
      migrated = await tableFingerprints(database, allShape);
    await migrate(drizzle(database.pool), { migrationsFolder: target.folder });
    expect(await tableFingerprints(database, allShape)).toEqual(migrated);
    expect(
      (await database.pool.query('SELECT id FROM drizzle.__drizzle_migrations')).rowCount,
    ).toBe(target.count);
  } finally {
    await database?.close();
    if (created) await dropTestDatabase(owner, name);
    await owner.close();
    if (fixture && dirname(resolve(fixture)) === resolve(temporaryRoot))
      await rm(fixture, { recursive: true, force: true });
  }
});
