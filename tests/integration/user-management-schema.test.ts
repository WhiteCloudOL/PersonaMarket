import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it, expect } from 'vitest';
import { z } from 'zod';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, createTestDatabaseOwner, type Database } from '@personamarket/database';
import { createAdministrator } from '@personamarket/server';
import { createTestDatabase, dropTestDatabase } from '../../scripts/test-database.js';
import { captureTableShape, tableFingerprints } from '../fixtures/table-fingerprints.js';
import { prepareScopedMigrations } from '../fixtures/scoped-migrations.js';

it.each([25, 26])(
  '从 %i 个既有迁移加入管理表和申请决定时保留数据，记录对owner和app均只能追加',
  async (baseline) => {
    const source = process.env['TEST_DATABASE_URL'];
    const applicationPassword = process.env['POSTGRES_APP_PASSWORD'];
    if (!source || !new URL(source).pathname.endsWith('_test') || !applicationPassword)
      throw new Error('必须使用真实隔离测试数据库');
    const rootOwner = createTestDatabaseOwner(source);
    const name = 'pm_it_' + randomUUID().replaceAll('-', '') + '_test';
    let database: Database | undefined;
    let appDatabase: Database | undefined;
    let created = false;
    let fixture: string | undefined;
    const temporaryRoot = fileURLToPath(new URL('../../data/tests/', import.meta.url));
    try {
      await createTestDatabase(rootOwner, name);
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
      const previous = journal.entries.filter((entry) => entry.idx < baseline);
      expect(previous).toHaveLength(baseline);
      await mkdir(temporaryRoot, { recursive: true });
      fixture = await mkdtemp(join(temporaryRoot, 'user-management-schema-'));
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
      const username = 'schema_' + randomUUID().replaceAll('-', '').slice(0, 10);
      await createAdministrator(database, {
        username,
        email: username + '@fixture.invalid',
        password: 'Schema fixture passphrase 2026',
      });
      const user = await database.pool.query<{ id: string }>(
        'SELECT id FROM users WHERE username=$1',
        [username],
      );
      const userId = user.rows[0]?.id;
      if (!userId) throw new Error('测试管理员不存在');
      for (const status of ['pending', 'withdrawn', 'approved', 'rejected'])
        await database.pool.query(
          'INSERT INTO deactivation_requests(user_id,reason,status) VALUES($1,$2,$3)',
          [userId, '保留既有' + status + '停用申请', status],
        );
      if (baseline === 26)
        await database.pool.query(
          "INSERT INTO user_management_records(actor_id,target_id,action,reason,from_role,to_role,from_status,to_status,from_security_version,to_security_version,scope,request_id) VALUES($1,$1,'revoke_sessions','保留已有管理依据','admin','admin','active','active',1,2,'account_only',$2)",
          [userId, randomUUID()],
        );
      const tableNames = await captureTableShape(database);
      const before = await tableFingerprints(database, tableNames);
      const migrationTarget = await prepareScopedMigrations(fixture, '0031_model_suggestions');
      expect(migrationTarget.count).toBe(32);
      await migrate(drizzle(database.pool), { migrationsFolder: migrationTarget.folder });
      expect(
        await tableFingerprints(database, tableNames, {
          expectedNewHomeSetting: true,
          expectedNewModelSuggestions: true,
        }),
      ).toEqual(before);
      await migrate(drizzle(database.pool), { migrationsFolder: migrationTarget.folder });
      expect(
        await tableFingerprints(database, tableNames, {
          expectedNewHomeSetting: true,
          expectedNewModelSuggestions: true,
        }),
      ).toEqual(before);
      expect(
        (await database.pool.query('SELECT * FROM drizzle.__drizzle_migrations')).rowCount,
      ).toBe(migrationTarget.count);
      expect((await database.pool.query('SELECT id FROM user_management_records')).rowCount).toBe(
        baseline === 26 ? 1 : 0,
      );
      expect((await database.pool.query('SELECT id FROM deactivation_decisions')).rowCount).toBe(0);
      expect(
        (
          await database.pool.query(
            'SELECT status FROM deactivation_requests WHERE user_id=$1 ORDER BY status',
            [userId],
          )
        ).rows.map((row: { status: string }) => row.status),
      ).toEqual(['approved', 'pending', 'rejected', 'withdrawn']);
      for (const status of ['approved', 'rejected', 'withdrawn'])
        await expect(
          database.pool.query(
            'UPDATE deactivation_requests SET reason=$3 WHERE user_id=$1 AND status=$2',
            [userId, status, '禁止改写旧申请'],
          ),
        ).rejects.toMatchObject({ code: '23514' });
      url.username = 'personamarket_app';
      url.password = applicationPassword;
      appDatabase = createDatabase(url.href);
      const record = await appDatabase.pool.query<{ id: string }>(
        "INSERT INTO user_management_records(actor_id,target_id,action,reason,from_role,to_role,from_status,to_status,from_security_version,to_security_version,scope,request_id) VALUES($1,$1,'revoke_sessions','约束验证','admin','admin','active','active',1,2,'account_only',$2) RETURNING id",
        [userId, randomUUID()],
      );
      const recordId = record.rows[0]?.id;
      if (!recordId) throw new Error('管理记录未保存');
      for (const statement of [
        'UPDATE user_management_records SET reason=$2 WHERE id=$1',
        'DELETE FROM user_management_records WHERE id=$1',
      ]) {
        const parameters = statement.startsWith('UPDATE') ? [recordId, '禁止改写'] : [recordId];
        await expect(database.pool.query(statement, parameters)).rejects.toMatchObject({
          code: '23514',
        });
        await expect(appDatabase.pool.query(statement, parameters)).rejects.toMatchObject({
          code: '42501',
        });
      }
      expect(
        (
          await appDatabase.pool.query('SELECT reason FROM user_management_records WHERE id=$1', [
            recordId,
          ])
        ).rows[0]?.reason,
      ).toBe('约束验证');
    } finally {
      await appDatabase?.close();
      await database?.close();
      if (created) await dropTestDatabase(rootOwner, name);
      await rootOwner.close();
      if (fixture && dirname(resolve(fixture)) === resolve(temporaryRoot)) {
        await rm(fixture, { recursive: true, force: true });
      }
    }
  },
);
