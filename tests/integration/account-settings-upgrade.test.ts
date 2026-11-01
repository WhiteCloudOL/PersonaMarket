import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve, relative, isAbsolute, basename } from 'node:path';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { z } from 'zod';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, createTestDatabaseOwner, type Database } from '@personamarket/database';
import { hashPassword } from '@personamarket/server';
import { createTestDatabase, dropTestDatabase } from '../../scripts/test-database.js';

const source = process.env['TEST_DATABASE_URL'];
if (!source || !new URL(source).pathname.endsWith('_test'))
  throw new Error('账户升级仅允许隔离TEST_DATABASE_URL');
const owner = createTestDatabaseOwner(source),
  created: string[] = [];
let fixtureRoot: string, previousFolder: string, upgradedFolder: string, passwordHash: string;
beforeAll(async () => {
  const tests = fileURLToPath(new URL('../../data/tests/', import.meta.url));
  await mkdir(tests, { recursive: true });
  fixtureRoot = await mkdtemp(join(tests, 'account-settings-upgrade-'));
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
  const index = journal.entries.findIndex((entry) => entry.tag === '0048_account_policy');
  expect(index).toBe(48);
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
  passwordHash = await hashPassword('A normal account upgrade fixture passphrase 2026');
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
        !basename(target).startsWith('account-settings-upgrade-')
      )
        throw new Error('拒绝清理非本轮账户升级夹具');
      await rm(target, { recursive: true, force: true });
    },
  ]) {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, '账户升级测试清理失败');
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
const cases = [
  {
    name: '旧null部署fallback',
    before: { registrationEnabled: null, sessionTtlSeconds: null },
    after: {
      registrationEnabled: null,
      sessionTtlSeconds: null,
      verificationEmailTiming: 'on_registration',
      registrationRateLimit: { maxAttempts: 10, windowSeconds: 3600 },
    },
  },
  {
    name: '已有全部自定义值',
    before: {
      registrationEnabled: false,
      sessionTtlSeconds: 7200,
      verificationEmailTiming: 'on_request',
      registrationRateLimit: { maxAttempts: 3, windowSeconds: 120 },
    },
    after: {
      registrationEnabled: false,
      sessionTtlSeconds: 7200,
      verificationEmailTiming: 'on_request',
      registrationRateLimit: { maxAttempts: 3, windowSeconds: 120 },
    },
  },
  {
    name: '嵌套缺失次数',
    before: {
      registrationEnabled: true,
      sessionTtlSeconds: 600,
      verificationEmailTiming: 'on_request',
      registrationRateLimit: { windowSeconds: 60 },
    },
    after: {
      registrationEnabled: true,
      sessionTtlSeconds: 600,
      verificationEmailTiming: 'on_request',
      registrationRateLimit: { maxAttempts: 10, windowSeconds: 60 },
    },
  },
  {
    name: '嵌套缺失窗口',
    before: {
      registrationEnabled: null,
      sessionTtlSeconds: null,
      registrationRateLimit: { maxAttempts: 2 },
    },
    after: {
      registrationEnabled: null,
      sessionTtlSeconds: null,
      verificationEmailTiming: 'on_registration',
      registrationRateLimit: { maxAttempts: 2, windowSeconds: 3600 },
    },
  },
];
it.each(cases)(
  '0048从48条到49条正常升级只补缺键并可重复执行：$name',
  async ({ before: value, after: expected }) =>
    isolated(async (database) => {
      await database.pool.query(
        "UPDATE site_settings SET value=$1,revision=17,updated_at='2026-10-28T00:00:00Z' WHERE key='accounts'",
        [value],
      );
      await database.pool.query(
        "INSERT INTO site_settings(key,value,revision) VALUES('account-upgrade-sentinel',$1,9)",
        [{ marker: '保留其他管理员自定义设置' }],
      );
      await database.pool.query(
        'INSERT INTO users(username,email,password_hash) VALUES($1,$2,$3)',
        ['upgrade_fixture', 'upgrade_fixture@fixture.invalid', passwordHash],
      );
      const before = await database.pool.query<{
        key: string;
        value: unknown;
        revision: number;
        updated_at: Date;
      }>('SELECT key,value,revision,updated_at FROM site_settings ORDER BY key');
      const business = await database.pool.query(
        'SELECT id,md5(to_jsonb(users)::text) AS digest FROM users ORDER BY id',
      );
      const prefix = await database.pool.query(
        'SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id',
      );
      expect(prefix.rows).toHaveLength(48);
      await migrate(drizzle(database.pool), { migrationsFolder: upgradedFolder });
      const after = await database.pool.query(
        'SELECT key,value,revision,updated_at FROM site_settings ORDER BY key',
      );
      expect(after.rows).toEqual(
        before.rows.map((row) => (row.key === 'accounts' ? { ...row, value: expected } : row)),
      );
      expect(
        (
          await database.pool.query(
            'SELECT id,md5(to_jsonb(users)::text) AS digest FROM users ORDER BY id',
          )
        ).rows,
      ).toEqual(business.rows);
      const migrations = await database.pool.query(
        'SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id',
      );
      expect(migrations.rows).toHaveLength(49);
      expect(migrations.rows.slice(0, 48)).toEqual(prefix.rows);
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
    }),
);
