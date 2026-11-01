import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createDatabase } from '@personamarket/database';
import {
  AuthContextResponseSchema,
  ModelSuggestionsResponseSchema,
  ModelSuggestionsRecordsResponseSchema,
  PublicModelSuggestionsResponseSchema,
  defaultModelSuggestions,
  modelSuggestionsEtag,
  type ModelSuggestionsWrite,
  emptyPersonaDraft,
  DraftResponseSchema,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator } from '../fixtures/creator.js';
import type { AuthHttp } from '../fixtures/auth-http.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});
const path = '/api/v1/admin/settings/model-suggestions';
const input: ModelSuggestionsWrite = {
  data: {
    entries: [
      { id: randomUUID(), modelId: 'fixture/provider-model', note: '公开建议', enabled: true },
      {
        id: randomUUID(),
        modelId: 'fixture/private-disabled',
        note: '停用说明不公开',
        enabled: false,
      },
    ],
  },
  reason: '按公开资料核对模型建议',
};
const write = (http: AuthHttp, expected: number, body = input, key = randomUUID()) =>
  http.write(path, body, 'PATCH', {
    'If-Match': modelSuggestionsEtag(expected),
    'Idempotency-Key': key,
  });
async function read(http: AuthHttp) {
  const response = await http.raw(path);
  expect(response.status).toBe(200);
  const result = ModelSuggestionsResponseSchema.parse(await response.json());
  expect(response.headers.get('etag')).toBe(modelSuggestionsEtag(result.meta.revision));
  expect(response.headers.get('cache-control')).toContain('no-store');
  return result;
}

it('有效管理员会话维护模型建议，公开配置立即变化，幂等与追加记录保留准确差异', async () => {
  const admin = await stack.admin();
  const account = AuthContextResponseSchema.parse(
    await (await admin.http.raw('/api/v1/auth/context')).json(),
  ).data.account;
  if (!account) throw new Error('缺少隔离管理员');
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET created_at=now()-interval '20 minutes',mfa_verified_at=now()-interval '20 minutes' WHERE user_id=$1",
    [account.id],
  );
  const initial = await read(admin.http);
  expect(initial.data).toEqual(defaultModelSuggestions);
  expect(initial.meta).toMatchObject({ revision: 1, updatedBy: null });
  const key = randomUUID();
  const saved = await write(admin.http, 1, input, key);
  expect(saved.status).toBe(200);
  const result = ModelSuggestionsResponseSchema.parse(await saved.json());
  expect(result.data).toEqual(input.data);
  expect(result.meta).toMatchObject({ revision: 2, updatedBy: account.username });
  expect((await write(admin.http, 1, input, key)).status).toBe(200);
  expect((await write(admin.http, 1, { ...input, reason: '不同请求' }, key)).status).toBe(409);
  expect((await write(admin.http, 1)).status).toBe(412);
  const publicResponse = await stack.browser().raw('/api/v1/site/model-suggestions');
  expect(publicResponse.status).toBe(200);
  expect(publicResponse.headers.get('cache-control')).toContain('no-store');
  const publicText = await publicResponse.text();
  expect(publicText).not.toContain(account.username);
  expect(publicText).not.toContain('fixture/private-disabled');
  expect(publicText).not.toContain('停用说明不公开');
  expect(publicText).not.toContain('updatedBy');
  expect(PublicModelSuggestionsResponseSchema.parse(JSON.parse(publicText))).toEqual({
    data: input.data.entries
      .filter((entry) => entry.enabled)
      .map(({ id, modelId, note }) => ({ id, modelId, note })),
    meta: { revision: 2 },
  });
  const records = ModelSuggestionsRecordsResponseSchema.parse(
    await (await admin.http.raw(path + '/records')).json(),
  );
  expect(records.meta.total).toBe(1);
  expect(records.data[0]).toMatchObject({
    before: defaultModelSuggestions,
    after: input.data,
    fromRevision: 1,
    toRevision: 2,
    reason: input.reason,
  });
  const record = records.data[0];
  if (!record) throw new Error('缺少真实修改记录');
  await expect(
    stack.owner.pool.query('UPDATE site_setting_records SET reason=$2 WHERE id=$1', [
      record.id,
      '篡改记录',
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  const app = createDatabase(stack.env.DATABASE_URL);
  try {
    await expect(
      app.pool.query('DELETE FROM site_setting_records WHERE id=$1', [record.id]),
    ).rejects.toMatchObject({ code: '42501' });
  } finally {
    await app.close();
  }
  expect((await write(admin.http, 2)).status).toBe(409);
  expect(
    (
      await write(admin.http, 2, {
        data: structuredClone(defaultModelSuggestions),
        reason: '核对后恢复默认展示',
      })
    ).status,
  ).toBe(200);
  expect((await read(admin.http)).data).toEqual(defaultModelSuggestions);
});

it('并发修改只有一个修订成功，非法建议、重复标识和缺少确认头均拒绝', async () => {
  const admin = await stack.admin();
  const responses = await Promise.all(
    ['第一份调整', '另一份调整'].map((note) =>
      write(admin.http, 1, {
        ...input,
        data: {
          entries: [{ id: randomUUID(), modelId: 'fixture/concurrent', note, enabled: true }],
        },
      }),
    ),
  );
  expect(responses.map((response) => response.status).sort()).toEqual([200, 412]);
  expect((await read(admin.http)).meta.revision).toBe(2);
  const badInputs = [
    { ...input, data: { entries: [{ ...input.data.entries[0], enabled: 'true' }] } },
    { ...input, data: { entries: [input.data.entries[0], input.data.entries[0]] } },
    { ...input, data: { ...input.data, html: '<script>alert(1)</script>' } },
    { ...input, reason: '' },
    { ...input, role: 'admin' },
  ];
  for (const bad of badInputs)
    expect(
      (
        await admin.http.write(path, bad, 'PATCH', {
          'If-Match': modelSuggestionsEtag(2),
          'Idempotency-Key': randomUUID(),
        })
      ).status,
    ).toBe(400);
  expect(
    (await admin.http.write(path, input, 'PATCH', { 'Idempotency-Key': randomUUID() })).status,
  ).toBe(400);
  expect(
    (await admin.http.write(path, input, 'PATCH', { 'If-Match': modelSuggestionsEtag(2) })).status,
  ).toBe(400);
  expect((await admin.http.raw(path + '/records?page=101')).status).toBe(400);
});

it('匿名、普通用户和审核员不能维护模型建议，账号变化、CSRF与撤权即时阻断', async () => {
  expect((await stack.browser().raw(path)).status).toBe(401);
  const creator = await verifiedCreator(stack);
  expect((await creator.http.raw(path)).status).toBe(403);
  expect((await write(creator.http, 1)).status).toBe(403);
  await stack.owner.pool.query("UPDATE users SET role='moderator' WHERE username=$1", [
    creator.username,
  ]);
  const moderator = stack.browser();
  expect(
    (
      await moderator.write('/api/v1/auth/login', {
        identifier: creator.username,
        password: creator.password,
      })
    ).status,
  ).toBe(200);
  expect((await moderator.raw(path)).status).toBe(403);
  expect((await write(moderator, 1)).status).toBe(403);
  const admin = await stack.admin();
  expect(
    (await admin.http.raw(path, { headers: { 'X-Expected-Account': randomUUID() } })).status,
  ).toBe(409);
  expect(
    (
      await admin.http.raw(path, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    ).status,
  ).toBe(403);
  const account = AuthContextResponseSchema.parse(
    await (await admin.http.raw('/api/v1/auth/context')).json(),
  ).data.account;
  if (!account) throw new Error('缺少隔离管理员');
  await stack.admin();
  await stack.owner.pool.query("UPDATE users SET status='banned' WHERE id=$1", [account.id]);
  expect((await admin.http.raw(path)).status).toBe(401);
});

it('配置损坏或数据库读取超时明确失败，不用默认值掩盖失败', async () => {
  const publicReader = stack.browser();
  const lock = await stack.owner.pool.connect();
  try {
    await lock.query('BEGIN');
    await lock.query('LOCK TABLE site_settings IN ACCESS EXCLUSIVE MODE');
    const unavailable = await publicReader.raw('/api/v1/site/model-suggestions');
    expect(unavailable.status).toBe(503);
    expect((await unavailable.json()).error.code).toBe('SERVICE_UNAVAILABLE');
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
  }
  await stack.owner.pool.query(
    "UPDATE site_settings SET value='{}'::jsonb WHERE key='modelSuggestions'",
  );
  const corrupted = await publicReader.raw('/api/v1/site/model-suggestions');
  expect(corrupted.status).toBe(500);
  expect((await corrupted.json()).error.code).toBe('INVALID_RESPONSE');
  await stack.owner.pool.query("DELETE FROM site_settings WHERE key='modelSuggestions'");
  expect((await publicReader.raw('/api/v1/site/model-suggestions')).status).toBe(503);
});

it('建议停用和移除不改写两平台的自由模型信息，也不构成保存门槛', async () => {
  const admin = await stack.admin();
  const author = await verifiedCreator(stack);
  const drafts = [];
  for (const platform of ['maibot', 'astrbot'] as const) {
    const draft = {
      ...emptyPersonaDraft(platform, '保留作者自定义模型'),
      recommendedModels: [
        { modelId: '  Unlisted 自定义/历史模型  ', note: '  作者原始备注\n保留换行  ' },
        { modelId: 'fixture/provider-model', note: '作者另行填写的备注' },
      ],
    };
    const response = await author.http.write('/api/v1/me/personas', {
      platform,
      title: draft.title,
      initialDraft: draft,
    });
    expect(response.status).toBe(200);
    const result = DraftResponseSchema.parse(await response.json());
    expect(result.data.draft.recommendedModels).toEqual(draft.recommendedModels);
    drafts.push(result);
  }
  expect((await write(admin.http, 1)).status).toBe(200);
  expect(
    (
      await write(admin.http, 2, {
        ...input,
        data: { entries: input.data.entries.map((entry) => ({ ...entry, enabled: false })) },
      })
    ).status,
  ).toBe(200);
  expect(
    PublicModelSuggestionsResponseSchema.parse(
      await (await stack.browser().raw('/api/v1/site/model-suggestions')).json(),
    ).data,
  ).toEqual([]);
  expect(
    (await write(admin.http, 3, { data: { entries: [] }, reason: '移除建议仍保留作者内容' }))
      .status,
  ).toBe(200);
  for (const original of drafts) {
    const path = '/api/v1/me/personas/' + original.data.id + '/draft';
    const current = DraftResponseSchema.parse(await (await author.http.raw(path)).json());
    expect(current).toEqual(original);
    expect(
      (
        await author.http.write(path, current.data.draft, 'PUT', {
          'If-Match': '"draft-' + current.meta.revision + '"',
        })
      ).status,
    ).toBe(200);
  }
});
