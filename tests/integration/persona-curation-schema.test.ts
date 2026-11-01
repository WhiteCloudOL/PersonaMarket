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
import { createTestDatabase, dropTestDatabase } from '../../scripts/test-database.js';
import { publicSnapshot } from '../fixtures/persona.js';
import { buildPublicSearchProjection } from '@personamarket/persona-adapters';
import {
  captureTableShape,
  tableFingerprints as fingerprints,
} from '../fixtures/table-fingerprints.js';
import { prepareScopedMigrations } from '../fixtures/scoped-migrations.js';

it('新增策展迁移保留全部旧表与冻结版本，重跑不清除策展设置且约束有效', async () => {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test'))
    throw new Error('必须使用真实隔离测试库');
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
    const baseline = journal.entries.findIndex((entry) => entry.tag === '0027_persona_curations');
    expect(baseline).toBe(27);
    const previous = journal.entries.slice(0, baseline);
    await mkdir(temporaryRoot, { recursive: true });
    fixture = await mkdtemp(join(temporaryRoot, 'persona-curation-schema-'));
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
    const username = 'curation_' + randomUUID().replaceAll('-', '').slice(0, 10);
    await createAdministrator(database, {
      username,
      email: username + '@fixture.invalid',
      password: 'Curation migration fixture passphrase 2026',
    });
    const user = await database.pool.query<{ id: string }>(
      'SELECT id FROM users WHERE username=$1',
      [username],
    );
    const userId = user.rows[0]?.id;
    if (!userId) throw new Error('缺少测试管理员');
    const personaId = randomUUID();
    const releaseId = randomUUID();
    const submissionId = randomUUID();
    const publishedAt = '2026-10-01T01:00:00Z';
    const publication = {
      publisher: username,
      category: { id: publicSnapshot.categoryId, name: '冻结分类' },
      tags: [],
    };
    await database.pool.query("INSERT INTO personas(id,owner_id,platform) VALUES($1,$2,'maibot')", [
      personaId,
      userId,
    ]);
    await database.pool.query(
      'INSERT INTO persona_drafts(persona_id,payload,revision) VALUES($1,$2,2)',
      [personaId, publicSnapshot],
    );
    const transaction = await database.pool.connect();
    try {
      await transaction.query('BEGIN');
      await transaction.query(
        "INSERT INTO persona_releases(id,persona_id,version,major,minor,patch,lifecycle,approved_submission_id,published_at) VALUES($1,$2,'1.0.0',1,0,0,'PUBLISHED',$3,$4)",
        [releaseId, personaId, submissionId, publishedAt],
      );
      await transaction.query(
        "INSERT INTO release_submissions(id,persona_id,release_id,submitted_by,attempt_number,snapshot,publication,changelog,content_hash,status) VALUES($1,$2,$3,$4,1,$5,$6,'原始冻结版本',$7,'APPROVED')",
        [submissionId, personaId, releaseId, userId, publicSnapshot, publication, 'a'.repeat(64)],
      );
      await transaction.query(
        'UPDATE personas SET published_release_id=$2,first_published_at=$3 WHERE id=$1',
        [personaId, releaseId, publishedAt],
      );
      // 正常旧数据已含可重建投影；避免把既有启动修复误算为本次DDL修改
      const fields = buildPublicSearchProjection(publicSnapshot, publication);
      await transaction.query(
        'INSERT INTO persona_public_projection(persona_id,release_id,title,summary,readme_text,search_text,publisher_name,author_names,tag_names,model_names,category_id,tag_ids,platform,origin_type,redistribution,dialogue_count,search_release_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10,$11::uuid,$12::uuid[],$13,$14,$15,$16,$2)',
        [
          personaId,
          releaseId,
          fields.title,
          fields.summary,
          fields.readmeText,
          fields.searchText,
          fields.publisherName,
          fields.authorNames,
          fields.tagNames,
          fields.modelNames,
          fields.categoryId,
          fields.tagIds,
          fields.platform,
          fields.originType,
          fields.redistribution,
          fields.dialogueCount,
        ],
      );
      await transaction.query('COMMIT');
    } catch (cause) {
      await transaction.query('ROLLBACK');
      throw cause;
    } finally {
      transaction.release();
    }
    const tables = await captureTableShape(database);
    const before = await fingerprints(database, tables);
    const target = await prepareScopedMigrations(fixture, '0027_persona_curations');
    expect(target.count).toBe(28);
    await migrate(drizzle(database.pool), { migrationsFolder: target.folder });
    expect(await fingerprints(database, tables)).toEqual(before);
    expect((await database.pool.query('SELECT * FROM persona_curations')).rows).toEqual([]);
    await database.pool.query(
      'INSERT INTO persona_curations(persona_id,updated_by_id,featured) VALUES($1,$2,true)',
      [personaId, userId],
    );
    const curation = await database.pool.query('SELECT * FROM persona_curations');
    expect(curation.rows[0]).toMatchObject({
      persona_id: personaId,
      official: false,
      featured: true,
      updated_by_id: userId,
    });
    await expect(
      database.pool.query('INSERT INTO persona_curations(persona_id,updated_by_id) VALUES($1,$2)', [
        personaId,
        userId,
      ]),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      database.pool.query('INSERT INTO persona_curations(persona_id,updated_by_id) VALUES($1,$2)', [
        randomUUID(),
        userId,
      ]),
    ).rejects.toMatchObject({ code: '23503' });
    await migrate(drizzle(database.pool), { migrationsFolder: target.folder });
    expect(await fingerprints(database, tables)).toEqual(before);
    expect((await database.pool.query('SELECT * FROM persona_curations')).rows).toEqual(
      curation.rows,
    );
    expect((await database.pool.query('SELECT * FROM drizzle.__drizzle_migrations')).rowCount).toBe(
      target.count,
    );
    // 原有默认设置断言单独验证0030/0031，不将后续业务设置变化混入0027验收。
    const seeds = await prepareScopedMigrations(fixture, '0031_model_suggestions');
    expect(seeds.count).toBe(32);
    const seedShape = await captureTableShape(database),
      seedBefore = await fingerprints(database, seedShape);
    await migrate(drizzle(database.pool), { migrationsFolder: seeds.folder });
    expect(
      await fingerprints(database, seedShape, {
        expectedNewHomeSetting: true,
        expectedNewModelSuggestions: true,
      }),
    ).toEqual(seedBefore);
    expect((await database.pool.query('SELECT * FROM persona_curations')).rows).toEqual(
      curation.rows,
    );
    const seededShape = await captureTableShape(database),
      seeded = await fingerprints(database, seededShape);
    await migrate(drizzle(database.pool), { migrationsFolder: seeds.folder });
    expect(
      await fingerprints(database, seedShape, {
        expectedNewHomeSetting: true,
        expectedNewModelSuggestions: true,
      }),
    ).toEqual(seedBefore);
    expect(await fingerprints(database, seededShape)).toEqual(seeded);
    expect(
      (await database.pool.query('SELECT id FROM drizzle.__drizzle_migrations')).rowCount,
    ).toBe(seeds.count);
  } finally {
    await database?.close();
    if (created) await dropTestDatabase(owner, name);
    await owner.close();
    if (fixture && dirname(resolve(fixture)) === resolve(temporaryRoot))
      await rm(fixture, { recursive: true, force: true });
  }
});
