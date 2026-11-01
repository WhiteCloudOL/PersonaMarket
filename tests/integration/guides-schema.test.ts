import { randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, createTestDatabaseOwner, type Database } from '@personamarket/database';
import { createAdministrator } from '@personamarket/server';
import { GuideFieldsSchema, GuideSlugSchema, emptyPersonaDraft } from '@personamarket/contracts';
import { createTestDatabase, dropTestDatabase } from '../../scripts/test-database.js';
import { captureTableShape, tableFingerprints } from '../fixtures/table-fingerprints.js';
import { prepareScopedMigrations } from '../fixtures/scoped-migrations.js';

it('指南迁移保留所有原数据，完整初始化九章和不可变发布记录，重复运行不改写编辑稿', async () => {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test'))
    throw new Error('必须使用真实隔离测试库');
  const owner = createTestDatabaseOwner(source);
  const name = 'pm_it_' + randomUUID().replaceAll('-', '') + '_test';
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
    const cutoff = journal.entries.findIndex((entry) => entry.tag === '0032_guides');
    expect(cutoff).toBe(32);
    const previous = journal.entries.slice(0, cutoff);
    await mkdir(temporaryRoot, { recursive: true });
    fixture = await mkdtemp(join(temporaryRoot, 'guides-schema-'));
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
    const username = 'guide_' + randomUUID().replaceAll('-', '').slice(0, 10);
    await createAdministrator(database, {
      username,
      email: username + '@fixture.invalid',
      password: 'Guide migration fixture passphrase 2026',
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
      emptyPersonaDraft('maibot', '指南迁移不能改写私有作品'),
    ]);
    const shape = await captureTableShape(database),
      before = await tableFingerprints(database, shape);
    const migrationTarget = await prepareScopedMigrations(fixture, '0032_guides');
    expect(migrationTarget.count).toBe(33);
    await migrate(drizzle(database.pool), { migrationsFolder: migrationTarget.folder });
    expect(await tableFingerprints(database, shape)).toEqual(before);
    const expected = z
      .array(GuideFieldsSchema.extend({ slug: GuideSlugSchema, originalText: z.string() }))
      .parse(
        JSON.parse(
          await readFile(new URL('../fixtures/guides-initial.json', import.meta.url), 'utf8'),
        ),
      );
    const rows = await database.pool.query<{
      slug: string;
      title: string;
      summary: string;
      bodyMarkdown: string;
      status: string;
      revision: number;
      updatedBy: string | null;
      publishedId: string;
      contentHash: string;
      publishedBody: string;
    }>(
      `SELECT e.slug,e.title,e.summary,e.body_markdown AS "bodyMarkdown",e.status,e.revision,e.updated_by AS "updatedBy",e.published_id AS "publishedId",p.content_hash AS "contentHash",p.body_markdown AS "publishedBody" FROM guide_entries e JOIN guide_publications p ON p.id=e.published_id AND p.slug=e.slug`,
    );
    expect(rows.rowCount).toBe(9);
    for (const original of expected) {
      const row = rows.rows.find((row) => row.slug === original.slug);
      if (!row) throw new Error('缺少原章节：' + original.slug);
      const fields = GuideFieldsSchema.parse({
        title: row.title,
        summary: row.summary,
        bodyMarkdown: row.bodyMarkdown,
      });
      expect(fields).toEqual({
        title: original.title,
        summary: original.summary,
        bodyMarkdown: original.bodyMarkdown,
      });
      expect(row).toMatchObject({
        status: 'published',
        revision: 1,
        updatedBy: null,
        publishedBody: original.bodyMarkdown,
      });
      expect(row.contentHash).toBe(
        createHash('sha256').update(JSON.stringify(fields)).digest('hex'),
      );
    }
    expect((await database.pool.query('SELECT id FROM guide_records')).rows).toEqual([]);
    const maibot = rows.rows.find((row) => row.slug === 'maibot'),
      astrbot = rows.rows.find((row) => row.slug === 'astrbot');
    if (!maibot || !astrbot) throw new Error('缺少平台指南');
    await expect(
      database.pool.query('UPDATE guide_publications SET title=$2 WHERE id=$1', [
        maibot.publishedId,
        '改写公开稿',
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      database.pool.query("UPDATE guide_entries SET published_id=$1 WHERE slug='maibot'", [
        astrbot.publishedId,
      ]),
    ).rejects.toMatchObject({ code: '23503' });
    const privileges = await database.pool.query<{
      update: boolean;
      delete: boolean;
      insert: boolean;
      select: boolean;
    }>(
      "SELECT has_table_privilege('personamarket_app','public.guide_publications','UPDATE') AS update,has_table_privilege('personamarket_app','public.guide_records','DELETE') AS delete,has_table_privilege('personamarket_app','public.guide_publications','INSERT') AS insert,has_table_privilege('personamarket_app','public.guide_publications','SELECT') AS select",
    );
    expect(privileges.rows[0]).toEqual({
      update: false,
      delete: false,
      insert: true,
      select: true,
    });
    await database.pool.query(
      "UPDATE guide_entries SET title='自定义未发布编辑稿',revision=revision+1 WHERE slug='maibot'",
    );
    const allShape = await captureTableShape(database),
      configured = await tableFingerprints(database, allShape);
    await migrate(drizzle(database.pool), { migrationsFolder: migrationTarget.folder });
    expect(await tableFingerprints(database, allShape)).toEqual(configured);
    expect(
      (await database.pool.query('SELECT id FROM drizzle.__drizzle_migrations')).rowCount,
    ).toBe(migrationTarget.count);
  } finally {
    await database?.close();
    if (created) await dropTestDatabase(owner, name);
    await owner.close();
    if (fixture && dirname(resolve(fixture)) === resolve(temporaryRoot))
      await rm(fixture, { recursive: true, force: true });
  }
});
