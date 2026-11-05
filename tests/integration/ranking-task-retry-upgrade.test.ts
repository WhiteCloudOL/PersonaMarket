import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve, relative, isAbsolute, basename } from 'node:path';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { z } from 'zod';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, createTestDatabaseOwner } from '@personamarket/database';
import { seedUpgradeAdministrator } from '../fixtures/upgrade-administrator.js';
import { createTestDatabase, dropTestDatabase } from '../../scripts/test-database.js';
import { captureTableShape, tableFingerprints } from '../fixtures/table-fingerprints.js';

const source = process.env['TEST_DATABASE_URL'];
if (!source || !new URL(source).pathname.endsWith('_test'))
  throw Error('排行升级只允许隔离TEST_DATABASE_URL');
const owner = createTestDatabaseOwner(source),
  created: string[] = [];
let fixtureRoot: string, previousFolder: string, upgradedFolder: string;
beforeAll(async () => {
  const tests = fileURLToPath(new URL('../../data/tests/', import.meta.url));
  await mkdir(tests, { recursive: true });
  fixtureRoot = await mkdtemp(join(tests, 'ranking-run-upgrade-'));
  const migrations = fileURLToPath(new URL('../../packages/database/migrations/', import.meta.url));
  const journal = z
    .object({
      version: z.string(),
      dialect: z.string(),
      entries: z.array(
        z.object({
          idx: z.number(),
          version: z.string(),
          when: z.number(),
          tag: z.string(),
          breakpoints: z.boolean(),
        }),
      ),
    })
    .parse(JSON.parse(await readFile(join(migrations, 'meta/_journal.json'), 'utf8')));
  const index = journal.entries.findIndex((entry) => entry.tag === '0050_ranking_generation_runs');
  expect(index).toBe(50);
  previousFolder = join(fixtureRoot, 'before');
  upgradedFolder = join(fixtureRoot, 'after');
  for (const [folder, entries] of [
    [previousFolder, journal.entries.slice(0, index)],
    [upgradedFolder, journal.entries.slice(0, index + 1)],
  ] as const) {
    await mkdir(join(folder, 'meta'), { recursive: true });
    await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
    for (const entry of entries)
      await writeFile(
        join(folder, entry.tag + '.sql'),
        await readFile(join(migrations, entry.tag + '.sql')),
      );
  }
});
afterAll(async () => {
  const errors: unknown[] = [];
  for (const cleanup of [
    async () => {
      for (const name of created) await dropTestDatabase(owner, name);
    },
    () => owner.close(),
    async () => {
      if (!fixtureRoot) return;
      const expected = resolve(fileURLToPath(new URL('../../data/tests/', import.meta.url))),
        target = resolve(fixtureRoot),
        part = relative(expected, target);
      if (
        !part ||
        isAbsolute(part) ||
        part.startsWith('..') ||
        !basename(target).startsWith('ranking-run-upgrade-')
      )
        throw Error('拒绝清理非本轮排行升级夹具');
      await rm(target, { recursive: true, force: true });
    },
  ])
    try {
      await cleanup();
    } catch (cause) {
      errors.push(cause);
    }
  if (errors.length) throw new AggregateError(errors, '排行升级测试清理失败');
});

it('0050正常50→51升级保留全部旧字段/设置/前缀，不猜旧failed5的事件、次数或终态，重跑无副作用', async () => {
  const name = 'pm_it_' + randomUUID().replaceAll('-', '') + '_test';
  await createTestDatabase(owner, name);
  created.push(name);
  const url = new URL(source ?? '');
  url.pathname = '/' + name;
  const database = createDatabase(url.href);
  try {
    await migrate(drizzle(database.pool), { migrationsFolder: previousFolder });
    await seedUpgradeAdministrator(database, {
      username: 'ranking_upgrade',
      email: 'ranking_upgrade@fixture.invalid',
      password: 'A ranking upgrade fixture passphrase 2026',
    });
    const actor = (
      await database.pool.query<{ id: string }>(
        "SELECT id FROM users WHERE username='ranking_upgrade'",
      )
    ).rows[0];
    if (!actor) throw Error('missing fixture actor');
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    for (const [index, status] of ['pending', 'failed', 'completed'].entries()) {
      await database.pool.query(
        "INSERT INTO ranking_generations(id,request_key,algorithm,status,attempts,error_code,generated_at) VALUES($1,$2,'interactions-v1',$3::text,5,CASE WHEN $3::text='failed' THEN 'RANKING_BUILD_FAILED' ELSE NULL END,CASE WHEN $3::text='completed' THEN clock_timestamp() ELSE NULL END)",
        [ids[index], 'upgrade-fixture:' + ids[index], status],
      );
      await database.pool.query(
        "INSERT INTO outbox_events(topic,payload,attempts) VALUES('rankings.refresh',jsonb_build_object('generationId',$1::text),5)",
        [ids[index]],
      );
    }
    await database.pool.query(
      "INSERT INTO admin_task_retries(source,task_id,event_id,actor_id,attempt,expected_version,reason) VALUES('ranking',$1,$2,$3,2,$4,'明确保留的旧排行人工记录')",
      [ids[1], randomUUID(), actor.id, 'a'.repeat(64)],
    );
    const shape = await captureTableShape(database),
      before = await tableFingerprints(database, shape);
    const prefix = (
      await database.pool.query(
        'SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id',
      )
    ).rows;
    expect(prefix).toHaveLength(50);
    await migrate(drizzle(database.pool), { migrationsFolder: upgradedFolder });
    expect(await tableFingerprints(database, shape)).toEqual(before);
    expect(
      (await database.pool.query('SELECT current_event_id FROM ranking_generations')).rows,
    ).toEqual([{ current_event_id: null }, { current_event_id: null }, { current_event_id: null }]);
    expect(
      (await database.pool.query('SELECT count(*)::int n FROM ranking_generation_runs')).rows,
    ).toEqual([{ n: 0 }]);
    const migrated = (
      await database.pool.query(
        'SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id',
      )
    ).rows;
    expect(migrated).toHaveLength(51);
    expect(migrated.slice(0, 50)).toEqual(prefix);
    await migrate(drizzle(database.pool), { migrationsFolder: upgradedFolder });
    expect(await tableFingerprints(database, shape)).toEqual(before);
    expect(
      (
        await database.pool.query(
          'SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id',
        )
      ).rows,
    ).toEqual(migrated);
  } finally {
    await database.close();
  }
});
