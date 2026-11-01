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
import {
  defaultModelSuggestions,
  ModelSuggestionsSchema,
  emptyPersonaDraft,
} from '@personamarket/contracts';
import { createTestDatabase, dropTestDatabase } from '../../scripts/test-database.js';
import { captureTableShape, tableFingerprints } from '../fixtures/table-fingerprints.js';
import { prepareScopedMigrations } from '../fixtures/scoped-migrations.js';

for (const preexisting of [false, true]) {
  it(
    preexisting
      ? '模型建议迁移保留预先存在的自定义设置、旧记录和草稿'
      : '模型建议迁移只增加准确空列表，重跑不覆盖配置',
    async () => {
      const source = process.env['TEST_DATABASE_URL'];
      if (!source || !new URL(source).pathname.endsWith('_test'))
        throw new Error('必须使用真实隔离测试数据库');
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
        const folder = fileURLToPath(
          new URL('../../packages/database/migrations/', import.meta.url),
        );
        const journal = z
          .object({
            entries: z.array(z.object({ idx: z.number(), tag: z.string() }).passthrough()),
          })
          .passthrough()
          .parse(JSON.parse(await readFile(join(folder, 'meta/_journal.json'), 'utf8')));
        const cutoff = journal.entries.findIndex((entry) => entry.tag === '0031_model_suggestions');
        expect(cutoff).toBe(31);
        const previous = journal.entries.slice(0, cutoff);
        await mkdir(temporaryRoot, { recursive: true });
        fixture = await mkdtemp(join(temporaryRoot, 'model-suggestions-schema-'));
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
        const username = 'models_' + randomUUID().replaceAll('-', '').slice(0, 10);
        await createAdministrator(database, {
          username,
          email: username + '@fixture.invalid',
          password: 'Home migration fixture passphrase 2026',
        });
        const user = (
          await database.pool.query<{ id: string }>('SELECT id FROM users WHERE username=$1', [
            username,
          ])
        ).rows[0];
        if (!user) throw new Error('缺少隔离测试管理员');
        const personaId = randomUUID();
        await database.pool.query(
          "INSERT INTO personas(id,owner_id,platform) VALUES($1,$2,'maibot')",
          [personaId, user.id],
        );
        await database.pool.query('INSERT INTO persona_drafts(persona_id,payload) VALUES($1,$2)', [
          personaId,
          emptyPersonaDraft('maibot', '模型建议设置不能影响私有作品'),
        ]);
        const custom = {
          entries: [
            {
              id: randomUUID(),
              modelId: 'fixture/custom-preserved',
              note: '原有建议',
              enabled: false,
            },
          ],
        };
        if (preexisting)
          await database.pool.query(
            "INSERT INTO site_settings(key,value,revision) VALUES('modelSuggestions',$1,7)",
            [custom],
          );
        const oldShape = await captureTableShape(database);
        const before = await tableFingerprints(database, oldShape);
        const migrationTarget = await prepareScopedMigrations(fixture, '0031_model_suggestions');
        expect(migrationTarget.count).toBe(32);
        await migrate(drizzle(database.pool), { migrationsFolder: migrationTarget.folder });
        expect(
          await tableFingerprints(
            database,
            oldShape,
            preexisting ? undefined : { expectedNewModelSuggestions: true },
          ),
        ).toEqual(before);
        const initialized = (
          await database.pool.query('SELECT value,revision FROM site_settings WHERE key=$1', [
            'modelSuggestions',
          ])
        ).rows[0];
        expect(ModelSuggestionsSchema.parse(initialized?.value)).toEqual(
          preexisting ? custom : defaultModelSuggestions,
        );
        expect(initialized?.revision).toBe(preexisting ? 7 : 1);
        expect((await database.pool.query('SELECT id FROM site_setting_records')).rows).toEqual([]);
        await database.pool.query(
          "UPDATE site_settings SET value=$1,revision=revision+1 WHERE key='modelSuggestions'",
          [{ entries: custom.entries.map((entry) => ({ ...entry, note: '更新后再次核对迁移' })) }],
        );
        const shape = await captureTableShape(database);
        const configured = await tableFingerprints(database, shape);
        await migrate(drizzle(database.pool), { migrationsFolder: migrationTarget.folder });
        expect(await tableFingerprints(database, shape)).toEqual(configured);
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
    },
  );
}
