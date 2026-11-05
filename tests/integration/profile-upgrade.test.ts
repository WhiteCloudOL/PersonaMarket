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
  PublicSnapshotSchema,
  ReportSnapshotSchema,
  emptyPersonaDraft,
} from '@personamarket/contracts';
import { createTestDatabase, dropTestDatabase } from '../../scripts/test-database.js';
import { captureTableShape, tableFingerprints } from '../fixtures/table-fingerprints.js';
import { publicSnapshot } from '../fixtures/persona.js';
import { prepareScopedMigrations } from '../fixtures/scoped-migrations.js';

it('0037至0039从真实旧举报升级保留全部旧字段和证据哈希，旧约束仍生效且重复迁移无变化', async () => {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test')) throw Error('必须使用隔离测试库');
  const owner = createTestDatabaseOwner(source);
  const name = 'pm_it_' + randomUUID().replaceAll('-', '') + '_test';
  const temporaryRoot = fileURLToPath(new URL('../../data/tests/', import.meta.url));
  let created = false,
    database: Database | undefined,
    fixture: string | undefined;
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
    const cutoff = journal.entries.findIndex((entry) => entry.tag === '0037_profiles');
    expect(cutoff).toBe(37);
    await mkdir(temporaryRoot, { recursive: true });
    fixture = await mkdtemp(join(temporaryRoot, 'profile-upgrade-'));
    if (dirname(resolve(fixture)) !== resolve(temporaryRoot)) throw Error('测试目录越界');
    await mkdir(join(fixture, 'meta'));
    const previous = journal.entries.slice(0, cutoff);
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
    expect(
      (await database.pool.query('SELECT id FROM drizzle.__drizzle_migrations')).rowCount,
    ).toBe(37);
    const username = 'legacy_' + randomUUID().replaceAll('-', '').slice(0, 12);
    const author = await seedUpgradeAdministrator(database, {
      username,
      email: username + '@fixture.invalid',
      password: 'Profile upgrade fixture passphrase 2026',
    });
    const reporterName = 'reporter_' + randomUUID().replaceAll('-', '').slice(0, 12);
    const reporter = await seedUpgradeAdministrator(database, {
      username: reporterName,
      email: reporterName + '@fixture.invalid',
      password: 'Legacy report fixture passphrase 2026',
    });
    const personaId = randomUUID(),
      releaseId = randomUUID(),
      submissionId = randomUUID(),
      commentId = randomUUID(),
      commentRevisionId = randomUUID();
    const category = (
      await database.pool.query<{ id: string; name: string }>(
        'SELECT id,name FROM categories ORDER BY id LIMIT 1',
      )
    ).rows[0];
    if (!category) throw Error('缺少旧分类');
    const snapshot = PublicSnapshotSchema.parse({ ...publicSnapshot, categoryId: category.id });
    await database.pool.query("INSERT INTO personas(id,owner_id,platform) VALUES($1,$2,'maibot')", [
      personaId,
      author.id,
    ]);
    await database.pool.query('INSERT INTO persona_drafts(persona_id,payload) VALUES($1,$2)', [
      personaId,
      emptyPersonaDraft('maibot', '升级保留的私有草稿'),
    ]);
    await database.pool.query(
      "INSERT INTO persona_releases(id,persona_id,version,major,minor,patch) VALUES($1,$2,'1.0.0',1,0,0)",
      [releaseId, personaId],
    );
    await database.pool.query(
      "INSERT INTO release_submissions(id,persona_id,release_id,submitted_by,attempt_number,snapshot,publication,changelog,content_hash,status) VALUES($1,$2,$3,$4,1,$5::jsonb,$6::jsonb,'升级前发布',$7,'APPROVED')",
      [
        submissionId,
        personaId,
        releaseId,
        author.id,
        JSON.stringify(snapshot),
        JSON.stringify({ publisher: username, category, tags: [] }),
        contentHash(snapshot),
      ],
    );
    await database.pool.query(
      "UPDATE persona_releases SET lifecycle='PUBLISHED',approved_submission_id=$2,published_at=now() WHERE id=$1",
      [releaseId, submissionId],
    );
    await database.pool.query(
      'UPDATE personas SET published_release_id=$2,first_published_at=now(),revision=revision+1 WHERE id=$1',
      [personaId, releaseId],
    );
    await database.db.insert(personaPublicProjection).values({
      personaId,
      releaseId,
      searchReleaseId: releaseId,
      ...buildPublicSearchProjection(snapshot, { publisher: username, category, tags: [] }),
    });
    // 沿用旧版审核状态机，在同一事务建立正文、获批指针及审核记录
    await database.db.transaction(async (tx) => {
      await tx.execute(
        sql`INSERT INTO comments(id,persona_id,author_id,release_id,latest_revision_id) VALUES(${commentId},${personaId},${author.id},${releaseId},${commentRevisionId})`,
      );
      await tx.execute(
        sql`INSERT INTO comment_revisions(id,comment_id,number,body) VALUES(${commentRevisionId},${commentId},1,'旧评论正文原样保留')`,
      );
      await tx.execute(
        sql`UPDATE comment_revisions SET status='APPROVED' WHERE id=${commentRevisionId}`,
      );
      await tx.execute(
        sql`INSERT INTO comment_moderation_records(comment_id,revision_id,actor_id,action,request_id) VALUES(${commentId},${commentRevisionId},${reporter.id},'approve',${randomUUID()})`,
      );
      await tx.execute(
        sql`UPDATE comments SET public_revision_id=${commentRevisionId},first_published_at=now(),revision=revision+1 WHERE id=${commentId}`,
      );
    });
    const reports: Array<{ id: string; hash: string }> = [];
    for (const type of ['persona', 'comment'] as const) {
      const evidence = ReportSnapshotSchema.parse({
        type,
        personaId,
        releaseId,
        version: '1.0.0',
        title: snapshot.title,
        summary: snapshot.summary,
        platform: 'maibot',
        author: { id: author.id, username },
        ...(type === 'comment'
          ? {
              comment: { id: commentId, revisionId: commentRevisionId, body: '旧评论正文原样保留' },
            }
          : {}),
      });
      const id = randomUUID(),
        hash = contentHash(evidence);
      await database.pool.query(
        "INSERT INTO reports(id,reporter_id,reported_user_id,type,target_id,target_revision_id,persona_id,release_id,comment_id,comment_revision_id,target_title,reason,details,snapshot,content_hash,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'other','升级前保留的私有说明',$12::jsonb,$13,$2)",
        [
          id,
          reporter.id,
          author.id,
          type,
          type === 'persona' ? personaId : commentId,
          type === 'persona' ? releaseId : commentRevisionId,
          personaId,
          releaseId,
          type === 'comment' ? commentId : null,
          type === 'comment' ? commentRevisionId : null,
          snapshot.title,
          JSON.stringify(evidence),
          hash,
        ],
      );
      await database.pool.query(
        "INSERT INTO report_actions(report_id,actor_id,action,after_status,from_revision,to_revision,request_id) VALUES($1,$2,'submitted','pending',0,1,$3)",
        [id, reporter.id, randomUUID()],
      );
      reports.push({ id, hash });
    }
    const shape = await captureTableShape(database),
      before = await tableFingerprints(database, shape);
    const migrations = (
      await database.pool.query(
        'SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id',
      )
    ).rows;
    const target = await prepareScopedMigrations(fixture, '0039_profile_reports');
    expect(target.count).toBe(40);
    await migrate(drizzle(database.pool), { migrationsFolder: target.folder });
    expect(await tableFingerprints(database, shape)).toEqual(before);
    expect(
      (
        await database.pool.query(
          'SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 37',
        )
      ).rows,
    ).toEqual(migrations);
    for (const table of [
      'user_profiles',
      'profile_drafts',
      'profile_submissions',
      'profile_records',
    ])
      expect((await database.pool.query(`SELECT 1 FROM ${table}`)).rows).toEqual([]);
    for (const report of reports) {
      const row = (
        await database.pool.query<{
          snapshot: unknown;
          content_hash: string;
          profile_user_id: string | null;
          profile_submission_id: string | null;
        }>(
          'SELECT snapshot,content_hash,profile_user_id,profile_submission_id FROM reports WHERE id=$1',
          [report.id],
        )
      ).rows[0];
      if (!row) throw Error('升级丢失旧举报');
      expect(row.content_hash).toBe(report.hash);
      expect(contentHash(ReportSnapshotSchema.parse(row.snapshot))).toBe(report.hash);
      expect(row.profile_user_id).toBeNull();
      expect(row.profile_submission_id).toBeNull();
      await expect(
        database.pool.query(
          "UPDATE reports SET details='篡改旧证据',revision=revision+1 WHERE id=$1",
          [report.id],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    }
    await expect(
      database.pool.query(
        'INSERT INTO reports(reporter_id,reported_user_id,type,target_id,target_revision_id,persona_id,release_id,target_title,reason,snapshot,content_hash,updated_by) SELECT reporter_id,reported_user_id,type,target_id,target_revision_id,NULL,release_id,target_title,reason,snapshot,content_hash,updated_by FROM reports WHERE id=$1',
        [reports[0]?.id],
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'reports_target_shape' });
    const migratedShape = await captureTableShape(database),
      migrated = await tableFingerprints(database, migratedShape);
    await migrate(drizzle(database.pool), { migrationsFolder: target.folder });
    expect(await tableFingerprints(database, migratedShape)).toEqual(migrated);
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
