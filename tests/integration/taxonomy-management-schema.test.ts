import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, createTestDatabaseOwner, type Database } from '@personamarket/database';
import { createAdministrator } from '@personamarket/server';
import { emptyPersonaDraft } from '@personamarket/contracts';
import { createTestDatabase, dropTestDatabase } from '../../scripts/test-database.js';
import { captureTableShape, tableFingerprints } from '../fixtures/table-fingerprints.js';
import { prepareScopedMigrations } from '../fixtures/scoped-migrations.js';

async function baseline(
  run: (database: Database, migrationFolder: string, total: number) => Promise<void>,
) {
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
    const cutoff = journal.entries.findIndex((entry) => entry.tag === '0028_taxonomy_management');
    expect(cutoff).toBe(28);
    const previous = journal.entries.slice(0, cutoff);
    await mkdir(temporaryRoot, { recursive: true });
    fixture = await mkdtemp(join(temporaryRoot, 'taxonomy-schema-'));
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
    const migrationTarget = await prepareScopedMigrations(fixture, '0031_model_suggestions');
    expect(migrationTarget.count).toBe(32);
    await run(database, migrationTarget.folder, migrationTarget.count);
  } finally {
    await database?.close();
    if (created) await dropTestDatabase(owner, name);
    await owner.close();
    if (fixture && dirname(resolve(fixture)) === resolve(temporaryRoot))
      await rm(fixture, { recursive: true, force: true });
  }
}

it('目录迁移保留每个既有字段和草稿，新增列默认值明确，重跑不覆盖运营配置', async () => {
  await baseline(async (database, url, total) => {
    const username = 'taxonomy_' + randomUUID().replaceAll('-', '').slice(0, 10);
    await createAdministrator(database, {
      username,
      email: username + '@fixture.invalid',
      password: 'Taxonomy migration fixture passphrase 2026',
    });
    const user = (
      await database.pool.query<{ id: string }>('SELECT id FROM users WHERE username=$1', [
        username,
      ])
    ).rows[0];
    if (!user) throw new Error('缺少测试管理员');
    const categoryId = randomUUID(),
      tagId = randomUUID(),
      personaId = randomUUID();
    await database.pool.query('INSERT INTO categories(id,name,active) VALUES($1,$2,false)', [
      categoryId,
      '保留停用的旧分类',
    ]);
    await database.pool.query('INSERT INTO tags(id,name,active) VALUES($1,$2,true)', [
      tagId,
      '原始标签文字',
    ]);
    await database.pool.query("INSERT INTO personas(id,owner_id,platform) VALUES($1,$2,'maibot')", [
      personaId,
      user.id,
    ]);
    await database.pool.query('INSERT INTO persona_drafts(persona_id,payload) VALUES($1,$2)', [
      personaId,
      { ...emptyPersonaDraft('maibot', '保留私有创作内容'), categoryId, tagIds: [tagId] },
    ]);
    const oldShape = await captureTableShape(database);
    const before = await tableFingerprints(database, oldShape);
    await migrate(drizzle(database.pool), { migrationsFolder: url });
    expect(
      await tableFingerprints(database, oldShape, {
        expectedNewHomeSetting: true,
        expectedNewModelSuggestions: true,
      }),
    ).toEqual(before);
    const category = (
      await database.pool.query('SELECT * FROM categories WHERE id=$1', [categoryId])
    ).rows[0];
    const tag = (await database.pool.query('SELECT * FROM tags WHERE id=$1', [tagId])).rows[0];
    expect(category).toMatchObject({
      name: '保留停用的旧分类',
      active: false,
      sort_order: 0,
      revision: 1,
      archived_at: null,
    });
    expect(tag).toMatchObject({
      name: '原始标签文字',
      active: true,
      sort_order: 0,
      revision: 1,
      archived_at: null,
    });
    expect(category?.updated_at).toBeInstanceOf(Date);
    expect((await database.pool.query('SELECT id FROM taxonomy_management_records')).rows).toEqual(
      [],
    );
    await database.pool.query(
      'UPDATE categories SET sort_order=-12,revision=revision+1 WHERE id=$1',
      [categoryId],
    );
    const currentShape = await captureTableShape(database);
    const configured = await tableFingerprints(database, currentShape);
    await migrate(drizzle(database.pool), { migrationsFolder: url });
    expect(await tableFingerprints(database, currentShape)).toEqual(configured);
    expect((await database.pool.query('SELECT * FROM drizzle.__drizzle_migrations')).rowCount).toBe(
      total,
    );
  });
});

it('旧目录有大小写重复时迁移安全回滚，不静默删除或重命名既有条目', async () => {
  await baseline(async (database, url) => {
    await database.pool.query(
      "INSERT INTO categories(name,active) VALUES('Preserved-Case',true),('preserved-case',false)",
    );
    const shape = await captureTableShape(database);
    const before = await tableFingerprints(database, shape);
    let code: string | undefined;
    try {
      await migrate(drizzle(database.pool), { migrationsFolder: url });
    } catch (cause) {
      let error: unknown = cause;
      for (let depth = 0; depth < 8 && error instanceof Error; depth++) {
        if ('code' in error) code = String(error.code);
        error = error.cause;
      }
    }
    expect(code).toBe('23505');
    expect(await tableFingerprints(database, shape)).toEqual(before);
    expect(
      (
        await database.pool.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='categories' AND column_name='revision'",
        )
      ).rowCount,
    ).toBe(0);
    expect((await database.pool.query('SELECT * FROM drizzle.__drizzle_migrations')).rowCount).toBe(
      28,
    );
    expect(
      (
        await database.pool.query(
          "SELECT to_regclass('public.taxonomy_management_records') AS table_name",
        )
      ).rows[0]?.table_name,
    ).toBeNull();
  });
});
