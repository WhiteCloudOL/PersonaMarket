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

it('公告新增迁移保留全部原字段和私有草稿，重跑不覆盖公告，发布与追加记录约束生效', async () => {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test'))
    throw new Error('必须使用真实隔离测试数据库');
  const owner = createTestDatabaseOwner(source);
  const name = 'pm_it_' + randomUUID().replaceAll('-', '') + '_test';
  const temporaryRoot = fileURLToPath(new URL('../../data/tests/', import.meta.url));
  let database: Database | undefined;
  let fixture: string | undefined;
  let created = false;
  try {
    await createTestDatabase(owner, name);
    created = true;
    const url = new URL(source);
    url.pathname = '/' + name;
    database = createDatabase(url.href);
    const folder = fileURLToPath(new URL('../../packages/database/migrations/', import.meta.url));
    const journal = z
      .object({ entries: z.array(z.object({ idx: z.number(), tag: z.string() }).passthrough()) })
      .passthrough()
      .parse(JSON.parse(await readFile(join(folder, 'meta/_journal.json'), 'utf8')));
    const cutoff = journal.entries.findIndex((entry) => entry.tag === '0029_announcements');
    expect(cutoff).toBe(29);
    const previous = journal.entries.slice(0, cutoff);
    await mkdir(temporaryRoot, { recursive: true });
    fixture = await mkdtemp(join(temporaryRoot, 'announcements-schema-'));
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
    const username = 'announcement_' + randomUUID().replaceAll('-', '').slice(0, 10);
    await seedUpgradeAdministrator(database, {
      username,
      email: username + '@fixture.invalid',
      password: 'Announcement migration fixture passphrase 2026',
    });
    const user = (
      await database.pool.query<{ id: string }>('SELECT id FROM users WHERE username=$1', [
        username,
      ])
    ).rows[0];
    if (!user) throw new Error('缺少测试管理员');
    const personaId = randomUUID();
    await database.pool.query("INSERT INTO personas(id,owner_id,platform) VALUES($1,$2,'maibot')", [
      personaId,
      user.id,
    ]);
    await database.pool.query('INSERT INTO persona_drafts(persona_id,payload) VALUES($1,$2)', [
      personaId,
      emptyPersonaDraft('maibot', '保留原有草稿和来源'),
    ]);
    const oldShape = await captureTableShape(database);
    const before = await tableFingerprints(database, oldShape);
    const migrationTarget = await prepareScopedMigrations(fixture, '0031_model_suggestions');
    expect(migrationTarget.count).toBe(32);
    await migrate(drizzle(database.pool), { migrationsFolder: migrationTarget.folder });
    expect(
      await tableFingerprints(database, oldShape, {
        expectedNewHomeSetting: true,
        expectedNewModelSuggestions: true,
      }),
    ).toEqual(before);
    expect(
      Number(
        (await database.pool.query('SELECT count(*) AS count FROM drizzle.__drizzle_migrations'))
          .rows[0]?.['count'],
      ),
    ).toBe(migrationTarget.count);
    const id = randomUUID();
    await database.pool.query(
      'INSERT INTO announcements(id,title,summary,body,pinned,created_by,updated_by) VALUES($1,$2,$3,$4,true,$5,$5)',
      [id, '迁移后的公告', '', '保留实际编辑稿\n不自动公开', user.id],
    );
    const row = (await database.pool.query('SELECT * FROM announcements WHERE id=$1', [id]))
      .rows[0];
    expect(row).toMatchObject({
      status: 'draft',
      revision: 1,
      pinned: true,
      published_snapshot: null,
      first_published_at: null,
      published_at: null,
    });
    await expect(
      database.pool.query("UPDATE announcements SET status='published' WHERE id=$1", [id]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      database.pool.query('UPDATE announcements SET body=$2 WHERE id=$1', [id, '字'.repeat(20001)]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      database.pool.query('UPDATE announcements SET revision=0 WHERE id=$1', [id]),
    ).rejects.toMatchObject({ code: '23514' });
    await migrate(drizzle(database.pool), { migrationsFolder: migrationTarget.folder });
    expect(
      (await database.pool.query('SELECT * FROM announcements WHERE id=$1', [id])).rows[0],
    ).toEqual(row);
    expect(
      await tableFingerprints(database, oldShape, {
        expectedNewHomeSetting: true,
        expectedNewModelSuggestions: true,
      }),
    ).toEqual(before);
  } finally {
    await database?.close();
    if (created) await dropTestDatabase(owner, name);
    await owner.close();
    if (fixture && dirname(resolve(fixture)) === resolve(temporaryRoot))
      await rm(fixture, { recursive: true, force: true });
  }
});
