import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import {
  createDatabase,
  createTestDatabaseOwner,
  personaPublicProjection,
  type Database,
} from '@personamarket/database';
import { contentHash } from '@personamarket/server';
import { seedUpgradeAdministrator } from '../fixtures/upgrade-administrator.js';
import { buildPublicSearchProjection } from '@personamarket/persona-adapters';
import {
  emptyPersonaDraft,
  PublicSnapshotSchema,
  PublicationSchema,
} from '@personamarket/contracts';
import { createTestDatabase, dropTestDatabase } from '../../scripts/test-database.js';
import { captureTableShape, tableFingerprints } from '../fixtures/table-fingerprints.js';
import { prepareScopedMigrations } from '../fixtures/scoped-migrations.js';

it('举报迁移保留旧表与指南全部数据，新表为空，应用无删除证据或改写记录的权限', async () => {
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
    const cutoff = journal.entries.findIndex((entry) => entry.tag === '0033_reports');
    expect(cutoff).toBe(33);
    const previous = journal.entries.slice(0, cutoff);
    await mkdir(temporaryRoot, { recursive: true });
    fixture = await mkdtemp(join(temporaryRoot, 'reports-schema-'));
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
      emptyPersonaDraft('maibot', '举报迁移不能改写私有作品'),
    ]);
    // 旧结构下的获批版本用于验证新增状态修订号的回填，不只检查空表升级
    const category = (
      await database.pool.query<{ id: string; name: string }>(
        'SELECT id,name FROM categories ORDER BY id LIMIT 1',
      )
    ).rows[0];
    if (!category) throw Error('缺少迁移样本分类');
    const snapshot = PublicSnapshotSchema.parse({
      schemaVersion: 1,
      title: '保留原已发布版本',
      summary: '旧结构的公开快照保持原样',
      categoryId: category.id,
      tagIds: [],
      readmeMarkdown: '# 原始内容\n\n迁移不能改写',
      recommendedModels: [],
      origin: { type: 'original', redistribution: 'not_allowed' },
      platform: 'maibot',
      content: { personality: '认真倾听', replyStyle: '自然亲切', behaviorStyle: '尊重彼此的边界' },
    });
    const publication = PublicationSchema.parse({ publisher: username, category, tags: [] });
    const releaseId = randomUUID(),
      submissionId = randomUUID();
    await database.db.transaction(async (tx) => {
      await tx.execute(
        sql`INSERT INTO persona_releases(id,persona_id,version,major,minor,patch) VALUES(${releaseId},${personaId},'1.0.0',1,0,0)`,
      );
      await tx.execute(sql`INSERT INTO release_submissions(id,persona_id,release_id,submitted_by,attempt_number,snapshot,publication,changelog,content_hash,status)
        VALUES(${submissionId},${personaId},${releaseId},${user.id},1,${JSON.stringify(snapshot)}::jsonb,${JSON.stringify(publication)}::jsonb,'旧结构发布快照',${contentHash(snapshot)},'APPROVED')`);
      await tx.execute(
        sql`UPDATE persona_releases SET lifecycle='PUBLISHED',approved_submission_id=${submissionId},published_at=now() WHERE id=${releaseId}`,
      );
      await tx.execute(
        sql`UPDATE personas SET published_release_id=${releaseId},first_published_at=(SELECT published_at FROM persona_releases WHERE id=${releaseId}),revision=revision+1 WHERE id=${personaId}`,
      );
      await tx.insert(personaPublicProjection).values({
        personaId,
        releaseId,
        searchReleaseId: releaseId,
        ...buildPublicSearchProjection(snapshot, publication),
      });
    });
    const shape = await captureTableShape(database),
      before = await tableFingerprints(database, shape);
    const migrationTarget = await prepareScopedMigrations(fixture, '0035_report_resolutions');
    expect(migrationTarget.count).toBe(36);
    await migrate(drizzle(database.pool), { migrationsFolder: migrationTarget.folder });
    expect(await tableFingerprints(database, shape)).toEqual(before);
    expect((await database.pool.query('SELECT id FROM reports')).rows).toEqual([]);
    expect((await database.pool.query('SELECT id FROM report_actions')).rows).toEqual([]);
    expect((await database.pool.query('SELECT action_id FROM report_resolutions')).rows).toEqual(
      [],
    );
    expect((await database.pool.query('SELECT id FROM notifications')).rows).toEqual([]);
    expect(
      (
        await database.pool.query(
          'SELECT moderation_revision,lifecycle FROM persona_releases WHERE id=$1',
          [releaseId],
        )
      ).rows,
    ).toEqual([{ moderation_revision: 1, lifecycle: 'PUBLISHED' }]);
    const permissions = await database.pool.query<{
      table: string;
      update: boolean;
      delete: boolean;
      insert: boolean;
      select: boolean;
    }>(
      `SELECT t AS "table",has_table_privilege('personamarket_app',t,'UPDATE') AS update,has_table_privilege('personamarket_app',t,'DELETE') AS delete,
       has_table_privilege('personamarket_app',t,'INSERT') AS insert,has_table_privilege('personamarket_app',t,'SELECT') AS select FROM unnest(ARRAY['reports','report_actions','report_resolutions']) t`,
    );
    expect(permissions.rows).toEqual([
      { table: 'reports', update: true, delete: false, insert: true, select: true },
      { table: 'report_actions', update: false, delete: false, insert: true, select: true },
      { table: 'report_resolutions', update: false, delete: false, insert: true, select: true },
    ]);
    const allShape = await captureTableShape(database),
      migrated = await tableFingerprints(database, allShape);
    await migrate(drizzle(database.pool), { migrationsFolder: migrationTarget.folder });
    expect(await tableFingerprints(database, allShape)).toEqual(migrated);
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
