import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve, relative, isAbsolute, basename } from 'node:path';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { z } from 'zod';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, createTestDatabaseOwner, type Database } from '@personamarket/database';
import { defaultSubmissionPendingHint } from '@personamarket/contracts';
import { createTestDatabase, dropTestDatabase } from '../../scripts/test-database.js';

const source = process.env['TEST_DATABASE_URL'];
if (!source || !new URL(source).pathname.endsWith('_test'))
  throw new Error('升级验收仅允许隔离TEST_DATABASE_URL');
const owner = createTestDatabaseOwner(source);
const created: string[] = [];
let fixtureRoot: string, previousFolder: string, upgradedFolder: string;
beforeAll(async () => {
  const tests = fileURLToPath(new URL('../../data/tests/', import.meta.url));
  await mkdir(tests, { recursive: true });
  fixtureRoot = await mkdtemp(join(tests, 'submission-hint-upgrade-'));
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
  const index = journal.entries.findIndex((entry) => entry.tag === '0047_submission_pending_hint');
  expect(index).toBe(47);
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
  const cleanup = [
    async () => {
      for (const name of created) await dropTestDatabase(owner, name);
    },
    () => owner.close(),
    async () => {
      if (!fixtureRoot) return;
      const expectedRoot = resolve(fileURLToPath(new URL('../../data/tests/', import.meta.url)));
      const resolved = resolve(fixtureRoot),
        part = relative(expectedRoot, resolved);
      if (
        !part ||
        isAbsolute(part) ||
        part.startsWith('..') ||
        !basename(resolved).startsWith('submission-hint-upgrade-')
      )
        throw new Error('拒绝清理非本轮升级夹具目录');
      await rm(resolved, { recursive: true, force: true });
    },
  ];
  for (const release of cleanup) {
    try {
      await release();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, '待审提示升级测试清理失败');
});
async function isolated(run: (database: Database) => Promise<void>) {
  const name = 'pm_it_' + randomUUID().replaceAll('-', '') + '_test';
  await createTestDatabase(owner, name);
  created.push(name);
  const url = new URL(source ?? '');
  url.pathname = '/' + name;
  const database = createDatabase(url.href);
  try {
    await migrate(drizzle(database.pool), { migrationsFolder: previousFolder });
    await run(database);
  } finally {
    await database.close();
  }
}

it('0047正常升级只补缺失提示，保留原投稿策略、所有其他设置、修订和更新时间', async () =>
  isolated(async (database) => {
    const legacy = { enabled: false, platforms: ['maibot'], dailyQuota: 7 };
    await database.pool.query(
      "UPDATE site_settings SET value=$1,revision=17,updated_at='2026-10-28T00:00:00Z' WHERE key='submissions'",
      [legacy],
    );
    await database.pool.query(
      "INSERT INTO site_settings(key,value,revision) VALUES('submission-upgrade-sentinel',$1,9)",
      [{ custom: '保留其他管理员自定义设置' }],
    );
    const before = await database.pool.query<{
      key: string;
      value: unknown;
      revision: number;
      updated_at: Date;
    }>('SELECT key,value,revision,updated_at FROM site_settings ORDER BY key');
    const prefix = await database.pool.query(
      'SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id',
    );
    expect(prefix.rows).toHaveLength(47);
    await migrate(drizzle(database.pool), { migrationsFolder: upgradedFolder });
    const after = await database.pool.query(
      'SELECT key,value,revision,updated_at FROM site_settings ORDER BY key',
    );
    expect(after.rows).toEqual(
      before.rows.map((row) =>
        row.key === 'submissions'
          ? { ...row, value: { ...legacy, pendingHint: defaultSubmissionPendingHint } }
          : row,
      ),
    );
    const migrations = await database.pool.query(
      'SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id',
    );
    expect(migrations.rows).toHaveLength(48);
    expect(migrations.rows.slice(0, 47)).toEqual(prefix.rows);
    await migrate(drizzle(database.pool), { migrationsFolder: upgradedFolder });
    expect(
      (
        await database.pool.query(
          'SELECT key,value,revision,updated_at FROM site_settings ORDER BY key',
        )
      ).rows,
    ).toEqual(after.rows);
    expect(
      (
        await database.pool.query(
          'SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id',
        )
      ).rows,
    ).toEqual(migrations.rows);
  }));

it.each(['既有自定义待审说明', ''])('已有pendingHint键保持原值：%j', async (pendingHint) =>
  isolated(async (database) => {
    const value = { enabled: true, platforms: ['astrbot'], dailyQuota: 4, pendingHint };
    await database.pool.query(
      "UPDATE site_settings SET value=$1,revision=12,updated_at='2026-10-29T00:00:00Z' WHERE key='submissions'",
      [value],
    );
    const before = await database.pool.query(
      'SELECT key,value,revision,updated_at FROM site_settings ORDER BY key',
    );
    await migrate(drizzle(database.pool), { migrationsFolder: upgradedFolder });
    expect(
      (
        await database.pool.query(
          'SELECT key,value,revision,updated_at FROM site_settings ORDER BY key',
        )
      ).rows,
    ).toEqual(before.rows);
  }),
);
