import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, createTestDatabaseOwner, migrateDatabase } from '@personamarket/database';
import { hashPassword } from '@personamarket/server';
import { createTestDatabase, dropTestDatabase } from '../../scripts/test-database.js';
import { prepareScopedMigrations } from '../fixtures/scoped-migrations.js';

it('0054 升到 0055 保留既有账号、作品和登录哈希，重复升级保持状态', async () => {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test')) throw new Error('缺少隔离测试库');
  const owner = createTestDatabaseOwner(source);
  const name = 'pm_it_' + randomUUID().replaceAll('-', '') + '_test';
  const url = new URL(source);
  url.pathname = '/' + name;
  await createTestDatabase(owner, name);
  const database = createDatabase(url.href);
  try {
    const root = fileURLToPath(new URL('../../data/tests/', import.meta.url));
    await mkdir(root, { recursive: true });
    const fixture = await mkdtemp(join(root, 'admin-deletion-upgrade-'));
    const old = await prepareScopedMigrations(fixture, '0054_email_verification_codes');
    await migrate(drizzle(database.pool), { migrationsFolder: old.folder });
    const id = randomUUID();
    const personaId = randomUUID();
    const passwordHash = await hashPassword('migration fixture passphrase 2026');
    await database.pool.query(
      `INSERT INTO users(id,username,email,password_hash,role) VALUES($1,'migration_owner','migration@fixture.invalid',$2,'admin')`,
      [id, passwordHash],
    );
    await database.pool.query(`INSERT INTO personas(id,owner_id,platform) VALUES($1,$2,'maibot')`, [
      personaId,
      id,
    ]);
    await migrateDatabase(url.href);
    await migrateDatabase(url.href);
    expect(
      (
        await database.pool.query(
          `SELECT username,role,status,deleted_at FROM users WHERE id=$1 AND password_hash=$2`,
          [id, passwordHash],
        )
      ).rows,
    ).toEqual([{ username: 'migration_owner', role: 'admin', status: 'active', deleted_at: null }]);
    expect(
      (
        await database.pool.query('SELECT owner_id,deleted_at FROM personas WHERE id=$1', [
          personaId,
        ])
      ).rows,
    ).toEqual([{ owner_id: id, deleted_at: null }]);
    expect(
      (await database.pool.query('SELECT id FROM drizzle.__drizzle_migrations')).rowCount,
    ).toBe(old.count + 1);
  } finally {
    await database.close();
    await dropTestDatabase(owner, name);
    await owner.close();
  }
});
