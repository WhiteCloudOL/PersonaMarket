import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  ErrorResponseSchema,
  RankingDefinitionSchema,
  RankingSettingsSchema,
  RankingSettingsResponseSchema,
  RankingSettingsRecordsResponseSchema,
  RankingRuntimeResponseSchema,
  defaultRankingSettings,
  rankingSettingsEtag,
  type RankingSettings,
} from '@personamarket/contracts';
import { createAdministrator } from '@personamarket/server';
import { createAuthStack } from '../fixtures/auth-stack.js';
import type { AuthHttp } from '../fixtures/auth-http.js';
import { verifiedCreator } from '../fixtures/creator.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});

const path = '/api/v1/admin/settings/rankings';
type WriteOptions = { key?: string; reason?: string; headers?: Record<string, string> };
const write = (http: AuthHttp, revision: number, data: unknown, options: WriteOptions = {}) =>
  http.write(path, { data, reason: options.reason ?? '核对排行与运营参数' }, 'PATCH', {
    'If-Match': rankingSettingsEtag(revision),
    'Idempotency-Key': options.key ?? randomUUID(),
    ...options.headers,
  });

async function effects() {
  const result = await stack.owner.pool.query<{
    records: number;
    audits: number;
    generations: number;
    outbox: number;
  }>(`SELECT
    (SELECT count(*)::integer FROM site_setting_records WHERE key='rankings') AS records,
    (SELECT count(*)::integer FROM auth_audit_events WHERE event='admin.ranking_settings_updated') AS audits,
    (SELECT count(*)::integer FROM ranking_generations) AS generations,
    (SELECT count(*)::integer FROM outbox_events WHERE topic='rankings.refresh') AS outbox`);
  const row = result.rows[0];
  if (!row) throw Error('缺少排行设置业务计数');
  return row;
}

async function readSettings(http: AuthHttp) {
  const response = await http.raw(path);
  expect(response.status).toBe(200);
  return RankingSettingsResponseSchema.parse(await response.json());
}

async function readRuntime(http: AuthHttp) {
  const response = await http.raw(path + '/status');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  return RankingRuntimeResponseSchema.parse(await response.json());
}

it('匿名、普通用户和审核员都不能读取或修改排行设置、运行状态与历史', async () => {
  const assertDenied = async (http: AuthHttp, status: number) => {
    for (const suffix of ['', '/status', '/records'])
      expect((await http.raw(path + suffix)).status).toBe(status);
    expect((await write(http, 1, { ...defaultRankingSettings, entryLimit: 10 })).status).toBe(
      status,
    );
  };
  await assertDenied(stack.browser(), 401);
  const user = await verifiedCreator(stack);
  await assertDenied(user.http, 403);
  await stack.owner.pool.query("UPDATE users SET role='moderator' WHERE username=$1", [
    user.username,
  ]);
  expect(
    (
      await user.http.write('/api/v1/auth/login', {
        identifier: user.username,
        password: user.password,
      })
    ).status,
  ).toBe(200);
  await assertDenied(user.http, 403);
  expect(await effects()).toEqual({ records: 0, audits: 0, generations: 0, outbox: 0 });
});

it('初始ETag、默认预览、空运行状态和空历史来自真实配置且禁止缓存', async () => {
  const admin = await stack.admin();
  const response = await admin.http.raw(path);
  expect(response.status).toBe(200);
  expect(response.headers.get('etag')).toBe(rankingSettingsEtag(1));
  expect(response.headers.get('cache-control')).toBe('no-store');
  const settings = RankingSettingsResponseSchema.parse(await response.json());
  expect(settings).toMatchObject({
    data: defaultRankingSettings,
    defaults: defaultRankingSettings,
    meta: { revision: 1, updatedBy: null },
  });
  expect(await readRuntime(admin.http)).toEqual({
    data: { latestRequest: null, latestCompleted: null },
    meta: { settingsRevision: 1 },
  });
  const records = await admin.http.raw(path + '/records');
  expect(records.status).toBe(200);
  expect(records.headers.get('cache-control')).toBe('no-store');
  expect(RankingSettingsRecordsResponseSchema.parse(await records.json())).toEqual({
    data: [],
    meta: { page: 1, pageSize: 20, total: 0 },
  });
  expect(await effects()).toEqual({ records: 0, audits: 0, generations: 0, outbox: 0 });
});

it('已绑定及未绑定MFA的有效管理员会话无需追加近期验证即可管理排行业务配置', async () => {
  const admin = await stack.admin();
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET created_at=now()-interval '20 minutes',mfa_verified_at=now()-interval '20 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1) AND revoked_at IS NULL",
    [admin.credentials.username],
  );
  expect((await readSettings(admin.http)).meta.revision).toBe(1);
  expect((await write(admin.http, 1, { ...defaultRankingSettings, entryLimit: 20 })).status).toBe(
    200,
  );
  expect((await readRuntime(admin.http)).meta.settingsRevision).toBe(2);
  expect((await admin.http.raw(path + '/records')).status).toBe(200);

  const username = 'plain_' + randomUUID().slice(0, 8);
  const password = 'A ranking settings administrator passphrase 2026';
  await createAdministrator(stack.owner, {
    username,
    email: username + '@fixture.invalid',
    password,
  });
  const plain = stack.browser();
  expect((await plain.write('/api/v1/auth/login', { identifier: username, password })).status).toBe(
    200,
  );
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET created_at=now()-interval '20 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1) AND revoked_at IS NULL",
    [username],
  );
  expect((await plain.context()).data.mfaEnabled).toBe(false);
  expect((await readSettings(plain)).meta.revision).toBe(2);
  expect((await write(plain, 2, { ...defaultRankingSettings, entryLimit: 30 })).status).toBe(200);
  expect((await readRuntime(plain)).meta.settingsRevision).toBe(3);
  expect((await plain.raw(path + '/records')).status).toBe(200);
  expect(await effects()).toEqual({ records: 2, audits: 2, generations: 2, outbox: 2 });
});

it('保存一并生成配置历史、审计与冻结v2请求，同键重放和不同载荷冲突都不重复产生业务记录', async () => {
  const admin = await stack.admin();
  const account = (await admin.http.context()).data.account;
  if (!account) throw Error('缺少隔离管理员');
  const data: RankingSettings = {
    weights: { likes: 0.5, favorites: 0, exports: 10 },
    refreshMinutes: 1,
    entryLimit: 37,
    newcomerWindowDays: 14,
  };
  const reason = '调整有效互动权重与新作展示范围';
  const key = randomUUID();
  const saved = await write(admin.http, 1, data, { key, reason });
  expect(saved.status).toBe(200);
  expect(saved.headers.get('etag')).toBe(rankingSettingsEtag(2));
  expect(RankingSettingsResponseSchema.parse(await saved.json())).toMatchObject({
    data,
    defaults: defaultRankingSettings,
    meta: { revision: 2, updatedBy: admin.credentials.username },
  });
  const committed = { records: 1, audits: 1, generations: 1, outbox: 1 };
  expect(await effects()).toEqual(committed);
  const repeated = await write(admin.http, 1, data, { key, reason });
  expect(repeated.status).toBe(200);
  expect(RankingSettingsResponseSchema.parse(await repeated.json()).meta.revision).toBe(2);
  expect(await effects()).toEqual(committed);
  const changed = await write(admin.http, 1, { ...data, entryLimit: 38 }, { key, reason });
  expect(changed.status).toBe(409);
  expect(ErrorResponseSchema.parse(await changed.json()).error.code).toBe('CONFLICT');
  expect(await effects()).toEqual(committed);

  const settings = await stack.owner.pool.query<{ value: unknown; revision: number }>(
    "SELECT value,revision FROM site_settings WHERE key='rankings'",
  );
  expect(settings.rows[0]?.revision).toBe(2);
  expect(RankingSettingsSchema.parse(settings.rows[0]?.value)).toEqual(data);
  const generationResult = await stack.owner.pool.query<{
    id: string;
    algorithm: string;
    status: string;
    settings_revision: number;
    definition: unknown;
    generated_at: Date | null;
    error_code: string | null;
  }>(
    'SELECT id,algorithm,status,settings_revision,definition,generated_at,error_code FROM ranking_generations',
  );
  expect(generationResult.rows).toHaveLength(1);
  const generation = generationResult.rows[0];
  if (!generation) throw Error('缺少实际排行请求');
  const definition = { settingsRevision: 2, settings: data, halfLifeSeconds: 604800 };
  expect(generation).toMatchObject({
    algorithm: 'interactions-v2',
    status: 'pending',
    settings_revision: 2,
    generated_at: null,
    error_code: null,
  });
  expect(RankingDefinitionSchema.parse(generation.definition)).toEqual(definition);
  const events = await stack.owner.pool.query<{
    payload: unknown;
    attempts: number;
    delivered_at: Date | null;
  }>("SELECT payload,attempts,delivered_at FROM outbox_events WHERE topic='rankings.refresh'");
  expect(events.rows).toEqual([
    { payload: { generationId: generation.id }, attempts: 0, delivered_at: null },
  ]);
  const audits = await stack.owner.pool.query<{ user_id: string; request_id: string }>(
    "SELECT user_id,request_id FROM auth_audit_events WHERE event='admin.ranking_settings_updated'",
  );
  expect(audits.rows).toHaveLength(1);
  expect(audits.rows[0]?.user_id).toBe(account.id);
  expect(audits.rows[0]?.request_id).toBe(saved.headers.get('x-request-id'));

  const firstRuntime = await readRuntime(admin.http);
  expect(firstRuntime).toMatchObject({
    data: {
      latestRequest: {
        id: generation.id,
        algorithm: 'interactions-v2',
        status: 'pending',
        definition,
      },
      latestCompleted: null,
    },
    meta: { settingsRevision: 2 },
  });
  const nextData = { ...data, refreshMinutes: 10, newcomerWindowDays: 60 };
  const nextReason = '延长刷新周期并调整新作窗口';
  expect((await write(admin.http, 2, nextData, { reason: nextReason })).status).toBe(200);
  const frozen = await stack.owner.pool.query<{ definition: unknown }>(
    'SELECT definition FROM ranking_generations WHERE id=$1',
    [generation.id],
  );
  expect(RankingDefinitionSchema.parse(frozen.rows[0]?.definition)).toEqual(definition);
  expect(await effects()).toEqual({ records: 2, audits: 2, generations: 2, outbox: 2 });
  const runtime = await readRuntime(admin.http);
  expect(runtime.data.latestRequest?.id).not.toBe(generation.id);
  expect(runtime.data.latestRequest?.definition).toEqual({
    settingsRevision: 3,
    settings: nextData,
    halfLifeSeconds: 604800,
  });
  expect(runtime.data.latestCompleted).toBeNull();
  expect(Object.keys(runtime.data.latestRequest ?? {}).sort()).toEqual(
    ['id', 'algorithm', 'status', 'definition', 'requestedAt', 'generatedAt', 'errorCode'].sort(),
  );
  const recordsResponse = await admin.http.raw(path + '/records');
  expect(recordsResponse.status).toBe(200);
  const records = RankingSettingsRecordsResponseSchema.parse(await recordsResponse.json());
  expect(records.meta).toEqual({ page: 1, pageSize: 20, total: 2 });
  expect(records.data).toMatchObject([
    {
      actor: admin.credentials.username,
      reason: nextReason,
      before: data,
      after: nextData,
      fromRevision: 2,
      toRevision: 3,
    },
    {
      actor: admin.credentials.username,
      reason,
      before: defaultRankingSettings,
      after: data,
      fromRevision: 1,
      toRevision: 2,
    },
  ]);
  expect(Object.keys(records.data[0] ?? {}).sort()).toEqual(
    ['id', 'actor', 'reason', 'before', 'after', 'fromRevision', 'toRevision', 'createdAt'].sort(),
  );
});

it('两个管理员以同一修订并发保存只有一个成功，CAS失败不留下额外历史、审计或刷新请求', async () => {
  const first = await stack.admin();
  const second = await stack.admin();
  const responses = await Promise.all([
    write(first.http, 1, { ...defaultRankingSettings, entryLimit: 11 }),
    write(second.http, 1, { ...defaultRankingSettings, entryLimit: 12 }),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([200, 412]);
  const accepted = responses.find((response) => response.status === 200);
  const rejected = responses.find((response) => response.status === 412);
  if (!accepted || !rejected) throw Error('缺少实际CAS竞争结果');
  const saved = RankingSettingsResponseSchema.parse(await accepted.json());
  expect(ErrorResponseSchema.parse(await rejected.json()).error.code).toBe('REVISION_CONFLICT');
  expect(saved.meta.revision).toBe(2);
  expect((await readSettings(first.http)).data).toEqual(saved.data);
  const committed = { records: 1, audits: 1, generations: 1, outbox: 1 };
  expect(await effects()).toEqual(committed);
  expect((await write(second.http, 1, { ...defaultRankingSettings, entryLimit: 13 })).status).toBe(
    412,
  );
  expect(await effects()).toEqual(committed);
  expect((await readRuntime(first.http)).data.latestRequest?.definition).toEqual({
    settingsRevision: 2,
    settings: saved.data,
    halfLifeSeconds: 604800,
  });
});

it('账号错配、缺少必要请求头、未知字段和越界值均拒绝且不改变配置或生成业务记录', async () => {
  const admin = await stack.admin();
  const wrongAccount = { 'X-Expected-Account': randomUUID() };
  for (const suffix of ['', '/status', '/records'])
    expect((await admin.http.raw(path + suffix, { headers: wrongAccount })).status).toBe(409);
  expect(
    (
      await write(
        admin.http,
        1,
        { ...defaultRankingSettings, entryLimit: 10 },
        {
          headers: wrongAccount,
        },
      )
    ).status,
  ).toBe(409);
  const command = {
    data: { ...defaultRankingSettings, entryLimit: 10 },
    reason: '核对请求校验保持',
  };
  expect(
    (
      await admin.http.write(path, command, 'PATCH', {
        'Idempotency-Key': randomUUID(),
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await admin.http.write(path, command, 'PATCH', {
        'If-Match': rankingSettingsEtag(1),
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await admin.http.write(path, { ...command, expectedRevision: 1 }, 'PATCH', {
        'If-Match': rankingSettingsEtag(1),
        'Idempotency-Key': randomUUID(),
      })
    ).status,
  ).toBe(400);
  for (const data of [
    { ...defaultRankingSettings, weights: { likes: -1, favorites: 4, exports: 1 } },
    { ...defaultRankingSettings, weights: { likes: 3, favorites: 101, exports: 1 } },
    { ...defaultRankingSettings, weights: { ...defaultRankingSettings.weights, comments: 1 } },
    { ...defaultRankingSettings, refreshMinutes: 0 },
    { ...defaultRankingSettings, refreshMinutes: 61 },
    { ...defaultRankingSettings, entryLimit: 1001 },
    { ...defaultRankingSettings, newcomerWindowDays: 366 },
    { ...defaultRankingSettings, newcomerWindowDays: 1.5 },
    { ...defaultRankingSettings, algorithm: 'interactions-v2' },
  ])
    expect((await write(admin.http, 1, data)).status).toBe(400);
  expect((await write(admin.http, 1, command.data, { reason: '' })).status).toBe(400);
  expect(await effects()).toEqual({ records: 0, audits: 0, generations: 0, outbox: 0 });
  expect((await readSettings(admin.http)).data).toEqual(defaultRankingSettings);
  expect((await readSettings(admin.http)).meta.revision).toBe(1);
  expect(await readRuntime(admin.http)).toEqual({
    data: { latestRequest: null, latestCompleted: null },
    meta: { settingsRevision: 1 },
  });
});
