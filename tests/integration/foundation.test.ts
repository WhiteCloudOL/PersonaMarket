import { randomUUID } from 'node:crypto';
import { listenHttp } from '../../scripts/http-server.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
const temporaryRoot = fileURLToPath(new URL('../../data/tests/', import.meta.url));
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createApplication } from '@personamarket/api/testing';
import { fetchPublicConfig } from '@personamarket/api-client';
import {
  ErrorResponseSchema,
  PublicConfigResponseSchema,
  ImportPreviewDataSchema,
  defaultHomeSettings,
  defaultTransferSettings,
  defaultMediaSettings,
  defaultRankingSettings,
  defaultModelSuggestions,
  defaultSubmissionPendingHint,
} from '@personamarket/contracts';
import {
  createDatabase,
  createTestDatabaseOwner,
  migrateDatabase,
  outboxEvents,
  siteSettings,
  type Database,
} from '@personamarket/database';
import {
  createLogger,
  createSystemQueue,
  createSystemWorker,
  dispatchOutbox,
  parseServerEnvironment,
  hashPassword,
} from '@personamarket/server';
import { publicSnapshot } from '../fixtures/persona.js';
import { testEnvironment } from '../fixtures/environment.js';
import { createTestDatabase, dropTestDatabase } from '../../scripts/test-database.js';

const sourceUrl = process.env['TEST_DATABASE_URL'];
const redisUrl = process.env['REDIS_URL'];
if (!sourceUrl || !new URL(sourceUrl).pathname.endsWith('_test') || !redisUrl) {
  throw new Error('真实集成测试要求独立 TEST_DATABASE_URL 和 REDIS_URL。');
}
const administrator = createTestDatabaseOwner(sourceUrl);
const createdDatabases: string[] = [];
async function isolatedDatabase() {
  const name = `pm_it_${randomUUID().replaceAll('-', '')}_test`;
  if (!/^pm_it_[a-f0-9]{32}_test$/.test(name)) throw new Error('测试数据库名称无效。');
  await createTestDatabase(administrator, name);
  createdDatabases.push(name);
  const url = new URL(sourceUrl as string);
  url.pathname = `/${name}`;
  return url.toString();
}
let database: Database;
let app: Awaited<ReturnType<typeof createApplication>>;
let baseUrl: string;
let databaseUrl: string;
let queue: ReturnType<typeof createSystemQueue>;
let worker: ReturnType<typeof createSystemWorker>;
const logger = createLogger('integration', 'silent');

beforeAll(async () => {
  databaseUrl = await isolatedDatabase();
  await migrateDatabase(databaseUrl);
  database = createDatabase(databaseUrl);
  const env = parseServerEnvironment({ ...testEnvironment(databaseUrl), REDIS_URL: redisUrl });
  app = await createApplication(env);
  baseUrl = await listenHttp(app);
  const name = `pm-it-${randomUUID()}`;
  queue = createSystemQueue(redisUrl, name);
  await queue.waitUntilReady();
  worker = createSystemWorker(database, redisUrl, name, logger);
  await worker.waitUntilReady();
});
afterAll(async () => {
  if (worker) await worker.close();
  if (queue) {
    await queue.obliterate({ force: true });
    await queue.close();
  }
  if (app) await app.close();
  if (database) await database.close();
  for (const name of createdDatabases) {
    if (!/^pm_it_[a-f0-9]{32}_test$/.test(name))
      throw new Error('拒绝删除非本次创建的测试数据库。');
    await dropTestDatabase(administrator, name);
  }
  await administrator.close();
});

describe('真实 PostgreSQL / Redis / API 基座', () => {
  it('空库迁移完成后可通过生成客户端读取，响应无内部字段', async () => {
    const result = await fetchPublicConfig(baseUrl);
    expect(result.data.name).toBe('清蒸云鸭·人设市场');
    expect(result.meta.revision).toBe(2);
    expect(result.data.description).toBe('创作、分享与发现 MaiBot 和 AstrBot 人设');
    const response = await fetch(`${baseUrl}/api/v1/public/config`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('etag')).toBe('"brand-2"');
    expect(response.headers.get('x-request-id')).toMatch(/^[a-f0-9-]{36}$/);
    expect(response.headers.get('x-powered-by')).toBeNull();
  });
  it('数据库字段即使包含秘密也不能通过公开 DTO 泄漏', async () => {
    await database.pool.query(
      "UPDATE site_settings SET value = value || $1::jsonb WHERE key = 'brand'",
      [JSON.stringify({ smtpPassword: 'PRIVATE_EVIDENCE_SENTINEL' })],
    );
    const response = await fetch(`${baseUrl}/api/v1/public/config`, {
      headers: { 'x-user-id': 'forged', 'x-role': 'admin' },
    });
    const raw = await response.text();
    expect(raw).not.toContain('PRIVATE_EVIDENCE_SENTINEL');
    expect(PublicConfigResponseSchema.parse(JSON.parse(raw)).data.name).toBe('清蒸云鸭·人设市场');
  });
  it('非法数据库内容返回安全错误，不泄漏验证输入或异常', async () => {
    const original = await database.pool.query<{ value: unknown }>(
      "SELECT value FROM site_settings WHERE key = 'brand'",
    );
    try {
      await database.pool.query("UPDATE site_settings SET value = $1::jsonb WHERE key = 'brand'", [
        JSON.stringify({ secret: 'INVALID_CONFIG_SENTINEL' }),
      ]);
      const response = await fetch(`${baseUrl}/api/v1/public/config`);
      expect(response.status).toBe(500);
      const raw = await response.text();
      expect(raw).not.toContain('INVALID_CONFIG_SENTINEL');
      expect(ErrorResponseSchema.parse(JSON.parse(raw)).error.code).toBe('INVALID_RESPONSE');
    } finally {
      await database.pool.query("UPDATE site_settings SET value = $1::jsonb WHERE key = 'brand'", [
        JSON.stringify(original.rows[0]?.value),
      ]);
    }
  });
  it('存活与就绪分离，依赖故障不返回假成功', async () => {
    expect((await fetch(`${baseUrl}/health/ready`)).status).toBe(200);
    const unavailable = await createApplication(
      parseServerEnvironment({
        ...testEnvironment(databaseUrl),
        REDIS_URL: 'redis://127.0.0.1:1/0',
      }),
    );
    try {
      await listenHttp(unavailable);
      const origin = await unavailable.getUrl();
      expect((await fetch(`${origin}/health/live`)).status).toBe(200);
      const response = await fetch(`${origin}/health/ready`);
      expect(response.status).toBe(503);
      expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(
        'SERVICE_UNAVAILABLE',
      );
    } finally {
      await unavailable.close();
    }
  });
  it('未开放的写入与管理路径不会接受伪造身份', async () => {
    const response = await fetch(`${baseUrl}/api/v1/public/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-role': 'admin' },
      body: '{}',
    });
    expect(response.status).toBe(404);
    expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe('NOT_FOUND');
    expect((await fetch(`${baseUrl}/api/v1/admin/settings`)).status).toBe(404);
  });
  it('并发重跑迁移不会覆盖配置或重复 bootstrap 事件', async () => {
    await Promise.all([migrateDatabase(databaseUrl), migrateDatabase(databaseUrl)]);
    const result = await database.pool.query<{ count: string }>(
      "SELECT count(*) FROM outbox_events WHERE topic = 'system.bootstrap'",
    );
    expect(result.rows[0]?.count).toBe('1');
  });
  it('事务失败时设置与 Outbox 一起回滚', async () => {
    const id = randomUUID();
    const key = `rollback-${id}`;
    await expect(
      database.db.transaction(async (transaction) => {
        await transaction.insert(siteSettings).values({ key, value: { title: '临时事务数据' } });
        await transaction
          .insert(outboxEvents)
          .values({ id, topic: 'system.probe', payload: { schemaVersion: 1 } });
        throw new Error('ROLLBACK_EXPECTED');
      }),
    ).rejects.toThrow('ROLLBACK_EXPECTED');
    expect(
      (await database.pool.query('SELECT key FROM site_settings WHERE key = $1', [key])).rowCount,
    ).toBe(0);
    expect(
      (await database.pool.query('SELECT id FROM outbox_events WHERE id = $1', [id])).rowCount,
    ).toBe(0);
  });
  it('数据库自身拒绝非法 revision', async () => {
    await expect(
      database.pool.query('INSERT INTO site_settings (key, value, revision) VALUES ($1, $2, 0)', [
        `invalid-${randomUUID()}`,
        '{}',
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('真实队列消费与并发重复投递只产生一个处理记录', async () => {
    const id = randomUUID();
    await database.pool.query(
      'INSERT INTO outbox_events (id, topic, payload) VALUES ($1, $2, $3)',
      [id, 'system.probe', '{"schemaVersion":1}'],
    );
    await dispatchOutbox(database, queue, logger);
    await expect
      .poll(
        async () =>
          (await database.pool.query('SELECT 1 FROM processed_events WHERE event_id = $1', [id]))
            .rowCount,
      )
      .toBe(1);
    const repeated = await Promise.all(
      [1, 2].map((attempt) =>
        queue.add(
          'system.probe',
          { eventId: id, schemaVersion: 1 },
          { jobId: `${id}-repeat-${attempt}` },
        ),
      ),
    );
    for (const job of repeated) await expect.poll(() => job.getState()).toBe('completed');
    expect(
      (await database.pool.query('SELECT 1 FROM processed_events WHERE event_id = $1', [id]))
        .rowCount,
    ).toBe(1);
  });
  it('旧版 schema 升级保留已有数据并补充初始化配置', async () => {
    const url = await isolatedDatabase();
    const old = createDatabase(url);
    await mkdir(temporaryRoot, { recursive: true });
    const fixture = await mkdtemp(join(temporaryRoot, 'personamarket-migrations-'));
    if (dirname(resolve(fixture)) !== resolve(temporaryRoot)) throw new Error('测试临时目录越界。');
    try {
      const folder = fileURLToPath(new URL('../../packages/database/migrations/', import.meta.url));
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
        .parse(JSON.parse(await readFile(join(folder, 'meta/_journal.json'), 'utf8')));
      const first = journal.entries[0];
      if (!first) throw new Error('缺少初始迁移。');
      await mkdir(join(fixture, 'meta'));
      await writeFile(
        join(fixture, 'meta/_journal.json'),
        JSON.stringify({ ...journal, entries: journal.entries.slice(0, 2) }),
      );
      for (const entry of journal.entries.slice(0, 2)) {
        await writeFile(
          join(fixture, `${entry.tag}.sql`),
          await readFile(join(folder, `${entry.tag}.sql`)),
        );
      }
      await migrate(drizzle(old.pool), { migrationsFolder: fixture });
      await old.pool.query('INSERT INTO site_settings (key, value) VALUES ($1, $2)', [
        'upgrade-sentinel',
        '{}',
      ]);
      await old.pool.query(
        "UPDATE site_settings SET value = jsonb_set(value, '{description}', $1::jsonb) WHERE key = 'brand'",
        [JSON.stringify('管理员的自定义介绍。')],
      );
      await migrateDatabase(url);
      expect(
        (
          await old.pool.query<{ description: string }>(
            "SELECT value->>'description' AS description FROM site_settings WHERE key = 'brand'",
          )
        ).rows[0]?.description,
      ).toBe('管理员的自定义介绍。');
      expect(
        (
          await old.pool.query(
            "SELECT key FROM site_settings WHERE key IN ('brand', 'upgrade-sentinel')",
          )
        ).rowCount,
      ).toBe(2);
    } finally {
      await old.close();
      await rm(fixture, { recursive: true, force: true });
    }
  });
  it('评论迁移从上一部署版本升级时保留关闭的互动开关和自定义配置，重复迁移不再改版本', async () => {
    const url = await isolatedDatabase();
    const old = createDatabase(url);
    await mkdir(temporaryRoot, { recursive: true });
    const fixture = await mkdtemp(join(temporaryRoot, 'personamarket-comment-upgrade-'));
    if (dirname(resolve(fixture)) !== resolve(temporaryRoot)) throw new Error('测试临时目录越界');
    try {
      const folder = fileURLToPath(new URL('../../packages/database/migrations/', import.meta.url));
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
        .parse(JSON.parse(await readFile(join(folder, 'meta/_journal.json'), 'utf8')));
      const commentIndex = journal.entries.findIndex((entry) => entry.tag === '0024_comments');
      expect(commentIndex).toBe(24);
      const previous = journal.entries.slice(0, commentIndex);
      await mkdir(join(fixture, 'meta'));
      await writeFile(
        join(fixture, 'meta/_journal.json'),
        JSON.stringify({ ...journal, entries: previous }),
      );
      for (const entry of previous)
        await writeFile(
          join(fixture, `${entry.tag}.sql`),
          await readFile(join(folder, `${entry.tag}.sql`)),
        );
      await migrate(drizzle(old.pool), { migrationsFolder: fixture });
      await old.pool.query("UPDATE site_settings SET value=$1,revision=8 WHERE key='community'", [
        { likesEnabled: false, favoritesEnabled: false },
      ]);
      await old.pool.query('INSERT INTO site_settings(key,value) VALUES ($1,$2)', [
        'comment-upgrade-sentinel',
        { custom: '管理员的既有自定义设置', enabled: false },
      ]);
      const untouched = await old.pool.query(
        "SELECT key,value,revision,updated_at FROM site_settings WHERE key<>'community' ORDER BY key",
      );
      await migrateDatabase(url);
      const upgraded = await old.pool.query<{ value: unknown; revision: number }>(
        "SELECT value,revision FROM site_settings WHERE key='community'",
      );
      expect(upgraded.rows).toEqual([
        {
          value: {
            likesEnabled: false,
            favoritesEnabled: false,
            commentsEnabled: true,
            showExistingComments: true,
            commentReviewMode: 'all',
            commentMaxLength: 2000,
            commentsPerMinute: 5,
          },
          revision: 9,
        },
      ]);
      const additionalSettings = await old.pool.query<{
        key: string;
        value: unknown;
        revision: number;
        updated_at: Date;
      }>(
        "SELECT key,value,revision,updated_at FROM site_settings WHERE key IN ('home','media','modelSuggestions','rankings','transfer') ORDER BY key",
      );
      expect(additionalSettings.rows).toEqual([
        {
          key: 'home',
          value: defaultHomeSettings,
          revision: 1,
          updated_at: expect.any(Date),
        },
        {
          key: 'media',
          value: defaultMediaSettings,
          revision: 1,
          updated_at: expect.any(Date),
        },
        {
          key: 'modelSuggestions',
          value: defaultModelSuggestions,
          revision: 1,
          updated_at: expect.any(Date),
        },
        {
          key: 'rankings',
          value: defaultRankingSettings,
          revision: 1,
          updated_at: expect.any(Date),
        },
        {
          key: 'transfer',
          value: defaultTransferSettings,
          revision: 1,
          updated_at: expect.any(Date),
        },
      ]);
      for (const row of additionalSettings.rows)
        expect(Number.isFinite(row.updated_at.getTime())).toBe(true);
      // 先核对唯一允许的新默认行，原设置所有字段和意外新增行仍受完整比较保护
      expect(
        (
          await old.pool.query(
            "SELECT key,value,revision,updated_at FROM site_settings WHERE key<>'community' AND key NOT IN ('home','media','modelSuggestions','rankings','transfer') ORDER BY key",
          )
        ).rows,
      ).toEqual(
        untouched.rows.map((row) =>
          row.key === 'submissions'
            ? {
                ...row,
                value: {
                  ...z.record(z.string(), z.unknown()).parse(row.value),
                  pendingHint: defaultSubmissionPendingHint,
                },
              }
            : row,
        ),
      );
      const allSettingsAfterUpgrade = await old.pool.query(
        'SELECT key,value,revision,updated_at FROM site_settings ORDER BY key',
      );
      await migrateDatabase(url);
      expect(
        (await old.pool.query("SELECT value,revision FROM site_settings WHERE key='community'"))
          .rows,
      ).toEqual(upgraded.rows);
      expect(
        (
          await old.pool.query(
            'SELECT key,value,revision,updated_at FROM site_settings ORDER BY key',
          )
        ).rows,
      ).toEqual(allSettingsAfterUpgrade.rows);
      expect((await old.pool.query('SELECT * FROM comments')).rowCount).toBe(0);
      expect((await old.pool.query('SELECT * FROM comment_revisions')).rowCount).toBe(0);
      expect((await old.pool.query('SELECT * FROM comment_moderation_records')).rowCount).toBe(0);
    } finally {
      await old.close();
      await rm(fixture, { recursive: true, force: true });
    }
  });
  it('原生导入预算升级保留既有私有预览，重跑幂等且数据库继续拒绝超过4MiB的数据', async () => {
    const url = await isolatedDatabase();
    const old = createDatabase(url);
    await mkdir(temporaryRoot, { recursive: true });
    const fixture = await mkdtemp(join(temporaryRoot, 'import-budget-upgrade-'));
    if (dirname(resolve(fixture)) !== resolve(temporaryRoot)) throw new Error('测试目录越界');
    try {
      const folder = fileURLToPath(new URL('../../packages/database/migrations/', import.meta.url));
      const journal = z
        .object({ entries: z.array(z.object({ idx: z.number(), tag: z.string() }).passthrough()) })
        .passthrough()
        .parse(JSON.parse(await readFile(join(folder, 'meta/_journal.json'), 'utf8')));
      const previous = journal.entries.filter((entry) => entry.idx < 21);
      expect(previous).toHaveLength(21);
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
      await migrate(drizzle(old.pool), { migrationsFolder: fixture });
      const userId = randomUUID();
      await old.pool.query(
        'INSERT INTO users(id,username,email,password_hash) VALUES($1,$2,$3,$4)',
        [
          userId,
          'budget_upgrade_writer',
          'budget-upgrade@fixture.invalid',
          await hashPassword('Budget upgrade fixture 2026'),
        ],
      );
      const data = ImportPreviewDataSchema.parse({
        id: randomUUID(),
        format: 'astrbot-json',
        filename: '旧预览.json',
        contentHash: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 1800000).toISOString(),
        persona: {
          platform: 'astrbot',
          content: { systemPrompt: '  既有私有正文\r\n保留空白  ', dialoguePairs: [] },
        },
        warnings: [],
        ignoredFields: [],
      });
      await old.pool.query(
        'INSERT INTO persona_imports(id,owner_id,format,content_hash,payload,expires_at) VALUES($1,$2,$3,$4,$5::jsonb,$6)',
        [data.id, userId, data.format, data.contentHash, JSON.stringify(data), data.expiresAt],
      );
      const before = await old.pool.query(
        'SELECT payload,content_hash,expires_at FROM persona_imports WHERE id=$1',
        [data.id],
      );
      expect(
        (
          await old.pool.query<{ definition: string }>(
            "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='import_payload_bounded'",
          )
        ).rows[0]?.definition,
      ).toContain('2097152');
      await migrateDatabase(url);
      await migrateDatabase(url);
      expect(
        (
          await old.pool.query(
            'SELECT payload,content_hash,expires_at FROM persona_imports WHERE id=$1',
            [data.id],
          )
        ).rows,
      ).toEqual(before.rows);
      for (const name of ['import_payload_bounded', 'draft_payload_bounded'])
        expect(
          (
            await old.pool.query<{ definition: string }>(
              'SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname=$1',
              [name],
            )
          ).rows[0]?.definition,
        ).toContain('4194304');
      await expect(
        old.pool.query(
          "UPDATE persona_imports SET payload=jsonb_build_object('oversized',repeat('x',4194304)) WHERE id=$1",
          [data.id],
        ),
      ).rejects.toMatchObject({ code: '23514', constraint: 'import_payload_bounded' });
      expect(
        (await old.pool.query('SELECT payload FROM persona_imports WHERE id=$1', [data.id])).rows[0]
          ?.payload,
      ).toEqual(data);
      expect((await old.pool.query('SELECT * FROM drizzle.__drizzle_migrations')).rowCount).toBe(
        journal.entries.length,
      );
    } finally {
      await old.close();
      await rm(fixture, { recursive: true, force: true });
    }
  });
  it('阶段2数据库升级重建搜索，保留冻结正文、标签与最早公开时间并可断点重跑', async () => {
    const url = await isolatedDatabase();
    const old = createDatabase(url);
    await mkdir(temporaryRoot, { recursive: true });
    const fixture = await mkdtemp(join(temporaryRoot, 'public-search-upgrade-'));
    if (dirname(resolve(fixture)) !== resolve(temporaryRoot)) throw new Error('测试目录越界');
    try {
      const folder = fileURLToPath(new URL('../../packages/database/migrations/', import.meta.url));
      const journal = z
        .object({ entries: z.array(z.object({ idx: z.number(), tag: z.string() }).passthrough()) })
        .passthrough()
        .parse(JSON.parse(await readFile(join(folder, 'meta/_journal.json'), 'utf8')));
      const previous = journal.entries.filter((entry) => entry.idx < 19);
      expect(previous).toHaveLength(19);
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
      await migrate(drizzle(old.pool), { migrationsFolder: fixture });
      const userId = randomUUID(),
        personaId = randomUUID();
      await old.pool.query(
        'INSERT INTO users(id,username,email,password_hash) VALUES($1,$2,$3,$4)',
        [
          userId,
          'upgrade_writer',
          'upgrade@fixture.invalid',
          await hashPassword('Isolated upgrade fixture 2026'),
        ],
      );
      await old.pool.query("INSERT INTO personas(id,owner_id,platform) VALUES($1,$2,'maibot')", [
        personaId,
        userId,
      ]);
      const snapshot = {
        ...publicSnapshot,
        readmeMarkdown: '# 星**河**\n\n[旧文](https://fixture.invalid/hidden)',
        tagIds: ['20000000-0000-4000-8000-000000000001'],
      };
      const publication = {
        publisher: '冻结作者',
        category: { id: snapshot.categoryId, name: '冻结分类' },
        tags: [{ id: snapshot.tagIds[0], name: '冻结风格' }],
      };
      const client = await old.pool.connect();
      let currentId = '';
      try {
        await client.query('BEGIN');
        for (const [index, publishedAt] of [
          '2024-01-01T00:00:00Z',
          '2025-01-01T00:00:00Z',
        ].entries()) {
          const releaseId = randomUUID(),
            submissionId = randomUUID();
          currentId = releaseId;
          await client.query(
            'INSERT INTO persona_releases(id,persona_id,version,major,minor,patch,lifecycle,approved_submission_id,published_at) VALUES($1,$2,$3,1,0,$4,$5,$6,$7)',
            [
              releaseId,
              personaId,
              '1.0.' + index,
              index,
              index === 0 ? 'WITHDRAWN' : 'PUBLISHED',
              submissionId,
              publishedAt,
            ],
          );
          await client.query(
            "INSERT INTO release_submissions(id,persona_id,release_id,submitted_by,attempt_number,snapshot,publication,changelog,content_hash,status) VALUES($1,$2,$3,$4,1,$5,$6,'冻结版本',$7,'APPROVED')",
            [
              submissionId,
              personaId,
              releaseId,
              userId,
              JSON.stringify(snapshot),
              JSON.stringify(publication),
              'a'.repeat(64),
            ],
          );
        }
        await client.query('UPDATE personas SET published_release_id=$2 WHERE id=$1', [
          personaId,
          currentId,
        ]);
        await client.query(
          'INSERT INTO persona_public_projection(persona_id,release_id,title,summary,readme_text) VALUES($1,$2,$3,$4,$5)',
          [personaId, currentId, snapshot.title, snapshot.summary, snapshot.readmeMarkdown],
        );
        await client.query('COMMIT');
      } catch (cause) {
        await client.query('ROLLBACK');
        throw cause;
      } finally {
        client.release();
      }
      const before = await old.pool.query(
        'SELECT snapshot,publication FROM release_submissions ORDER BY id',
      );
      await migrateDatabase(url);
      const result = await old.pool.query<{
        search_text: string;
        readme_text: string;
        search_release_id: string;
        first_at: string;
      }>(
        "SELECT p.search_text,p.readme_text,p.search_release_id,to_char(a.first_published_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS first_at FROM persona_public_projection p JOIN personas a ON a.id=p.persona_id",
      );
      expect(result.rows[0]).toMatchObject({
        search_release_id: currentId,
        first_at: '2024-01-01',
        readme_text: '星河 旧文',
      });
      expect(result.rows[0]?.search_text).toContain('冻结风格');
      expect(result.rows[0]?.search_text).not.toContain('https://');
      await old.pool.query(
        "UPDATE persona_public_projection SET search_release_id=NULL,search_text=''",
      );
      await migrateDatabase(url);
      expect(
        (await old.pool.query('SELECT snapshot,publication FROM release_submissions ORDER BY id'))
          .rows,
      ).toEqual(before.rows);
      const repaired = await old.pool.query('SELECT * FROM persona_public_projection');
      await migrateDatabase(url);
      expect((await old.pool.query('SELECT * FROM persona_public_projection')).rows).toEqual(
        repaired.rows,
      );
      expect((await old.pool.query('SELECT * FROM drizzle.__drizzle_migrations')).rowCount).toBe(
        journal.entries.length,
      );
    } finally {
      await old.close();
      await rm(fixture, { recursive: true, force: true });
    }
  });
  it('非法 Outbox 消息保留失败状态，有限重试且不会写入消费者记录', async () => {
    const id = randomUUID();
    await database.pool.query(
      'INSERT INTO outbox_events (id, topic, payload) VALUES ($1, $2, $3)',
      [id, 'unsupported.topic', '{"schemaVersion":1}'],
    );
    for (let attempt = 1; attempt <= 5; attempt++) {
      await database.pool.query('UPDATE outbox_events SET available_at = now() WHERE id = $1', [
        id,
      ]);
      await dispatchOutbox(database, queue, logger);
      const result = await database.pool.query<{
        attempts: number;
        last_error_code: string;
        delivered_at: Date | null;
        lease_until: Date | null;
        delayed: boolean;
      }>(
        'SELECT attempts, last_error_code, delivered_at, lease_until, available_at > now() AS delayed FROM outbox_events WHERE id = $1',
        [id],
      );
      expect(result.rows[0]).toEqual({
        attempts: attempt,
        last_error_code: 'DELIVERY_FAILED',
        delivered_at: null,
        lease_until: null,
        delayed: true,
      });
    }
    await database.pool.query('UPDATE outbox_events SET available_at = now() WHERE id = $1', [id]);
    await dispatchOutbox(database, queue, logger);
    expect(
      (
        await database.pool.query<{ attempts: number }>(
          'SELECT attempts FROM outbox_events WHERE id = $1',
          [id],
        )
      ).rows[0]?.attempts,
    ).toBe(5);
    expect(
      (await database.pool.query('SELECT 1 FROM processed_events WHERE event_id = $1', [id]))
        .rowCount,
    ).toBe(0);
  });
  it('Worker 启动连接失败会关闭已分配资源并以失败码退出', async () => {
    const run = promisify(execFile);
    const script = fileURLToPath(new URL('../../apps/worker/dist/main.js', import.meta.url));
    await expect(
      run(process.execPath, [script], {
        env: {
          ...process.env,
          ...testEnvironment(databaseUrl),
          REDIS_URL: 'redis://127.0.0.1:1/0',
        },
        timeout: 5_000,
        windowsHide: true,
      }),
    ).rejects.toMatchObject({ code: 1, killed: false });
  });
});
