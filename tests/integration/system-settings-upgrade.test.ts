import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve, relative, isAbsolute, basename } from 'node:path';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { z } from 'zod';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, createTestDatabaseOwner, type Database } from '@personamarket/database';
import { defaultSystemSettings } from '@personamarket/contracts';
import { seedUpgradeAdministrator } from '../fixtures/upgrade-administrator.js';
import { createTestDatabase, dropTestDatabase } from '../../scripts/test-database.js';
import { captureTableShape, tableFingerprints } from '../fixtures/table-fingerprints.js';

const source = process.env['TEST_DATABASE_URL'];
if (!source || !new URL(source).pathname.endsWith('_test'))
  throw new Error('System升级仅允许隔离TEST_DATABASE_URL');
const owner = createTestDatabaseOwner(source),
  created: string[] = [];
let fixtureRoot: string, previousFolder: string, upgradedFolder: string;
beforeAll(async () => {
  const tests = fileURLToPath(new URL('../../data/tests/', import.meta.url));
  await mkdir(tests, { recursive: true });
  fixtureRoot = await mkdtemp(join(tests, 'system-settings-upgrade-'));
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
  const index = journal.entries.findIndex((entry) => entry.tag === '0049_system_settings');
  expect(index).toBe(49);
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
        !basename(target).startsWith('system-settings-upgrade-')
      )
        throw new Error('拒绝清理非本轮System升级夹具');
      await rm(target, { recursive: true, force: true });
    },
  ]) {
    try {
      await cleanup();
    } catch (cause) {
      errors.push(cause);
    }
  }
  if (errors.length) throw new AggregateError(errors, 'System升级测试清理失败');
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
it.each([
  { name: '缺少System行', value: undefined },
  {
    name: '已有完整自定义维护值',
    value: { maintenanceEnabled: true, maintenanceMessage: '保留既有公共说明' },
  },
  { name: '已有未知旧值不静默修复', value: { previousOperatorValue: '保留用于人工核对' } },
])('0049正常49→50升级只补默认行、保留全部原数据和迁移前缀并可重跑：$name', async ({ value }) =>
  isolated(async (database) => {
    if (value !== undefined)
      await database.pool.query(
        "INSERT INTO site_settings(key,value,revision,updated_at) VALUES('system',$1,17,'2026-10-28T00:00:00Z')",
        [value],
      );
    await database.pool.query(
      "INSERT INTO site_settings(key,value,revision) VALUES('system-upgrade-sentinel',$1,9)",
      [{ retained: '全部原设置保持' }],
    );
    await seedUpgradeAdministrator(database, {
      username: 'system_upgrade',
      email: 'system_upgrade@fixture.invalid',
      password: 'A controlled upgrade fixture passphrase 2026',
    });
    const settingsBefore = await database.pool.query(
      'SELECT key,value,revision,updated_at FROM site_settings ORDER BY key',
    );
    const shape = await captureTableShape(database),
      otherShape = Object.fromEntries(
        Object.entries(shape).filter(([table]) => table !== 'site_settings'),
      );
    const before = await tableFingerprints(database, otherShape),
      prefix = await database.pool.query(
        'SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id',
      );
    expect(prefix.rows).toHaveLength(49);
    await migrate(drizzle(database.pool), { migrationsFolder: upgradedFolder });
    const settingsAfter = await database.pool.query<{
      key: string;
      value: unknown;
      revision: number;
      updated_at: Date;
    }>('SELECT key,value,revision,updated_at FROM site_settings ORDER BY key');
    const system = settingsAfter.rows.find((row) => row.key === 'system');
    if (!system) throw new Error('迁移没有产生System行');
    if (value === undefined) {
      expect(system.value).toEqual(defaultSystemSettings);
      expect(system.revision).toBe(1);
      expect(system.updated_at).toBeInstanceOf(Date);
      expect(settingsAfter.rows.filter((row) => row.key !== 'system')).toEqual(settingsBefore.rows);
    } else expect(settingsAfter.rows).toEqual(settingsBefore.rows);
    expect(await tableFingerprints(database, otherShape)).toEqual(before);
    const migrations = await database.pool.query(
      'SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id',
    );
    expect(migrations.rows).toHaveLength(50);
    expect(migrations.rows.slice(0, 49)).toEqual(prefix.rows);
    await migrate(drizzle(database.pool), { migrationsFolder: upgradedFolder });
    expect(
      (
        await database.pool.query(
          'SELECT key,value,revision,updated_at FROM site_settings ORDER BY key',
        )
      ).rows,
    ).toEqual(settingsAfter.rows);
    expect(await tableFingerprints(database, otherShape)).toEqual(before);
    expect(
      (
        await database.pool.query(
          'SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id',
        )
      ).rows,
    ).toEqual(migrations.rows);
  }),
);
