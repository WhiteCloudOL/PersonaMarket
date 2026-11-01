import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DraftResponseSchema, ImportPreviewResponseSchema } from '@personamarket/contracts';
import { serializeAstrBot } from '@personamarket/persona-adapters';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator } from '../fixtures/creator.js';
import type { AuthHttp } from '../fixtures/auth-http.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeAll(async () => {
  stack = await createAuthStack();
});
afterAll(async () => {
  await stack?.close();
});

async function upload(http: AuthHttp, bytes: Buffer, encoding = 'auto') {
  const context = await http.context();
  const body = new FormData();
  body.set('file', new Blob([Buffer.from(bytes)]), '大正文.json');
  return fetch(
    http.base + '/api/v1/me/persona-imports/preview/file?format=astrbot-json&encoding=' + encoding,
    {
      method: 'POST',
      body,
      headers: {
        Origin: http.origin,
        'X-CSRF-Token': context.data.csrfToken,
        Cookie: [...http.cookies].map(([name, value]) => name + '=' + value).join('; '),
      },
      signal: AbortSignal.timeout(10000),
    },
  );
}

it('超过旧2MiB预览大小的合法原生正文可完整保存为4MiB以内草稿', async () => {
  const owner = await verifiedCreator(stack);
  const persona = {
    platform: 'astrbot' as const,
    content: {
      systemPrompt: 'p'.repeat(100000),
      dialoguePairs: Array.from({ length: 100 }, () => ({
        id: randomUUID(),
        user: 'q'.repeat(15000),
        assistant: 'a'.repeat(15000),
      })),
    },
  };
  const bytes = Buffer.from(serializeAstrBot(persona, '大正文'));
  expect(bytes.length).toBeGreaterThan(2 * 1024 * 1024);
  expect(bytes.length).toBeLessThan(4 * 1024 * 1024);
  const response = await upload(owner.http, bytes);
  expect(response.status).toBe(200);
  const preview = ImportPreviewResponseSchema.parse(await response.json()).data;
  const saved = await owner.http.write('/api/v1/me/persona-imports/confirm', {
    previewId: preview.id,
    contentHash: preview.contentHash,
    title: '完整大正文',
    sourceDescription: '原作者提供的测试文件，正文保持完整',
    target: { mode: 'new' },
    confirmed: true,
  });
  expect(saved.status).toBe(200);
  const draft = DraftResponseSchema.parse(await saved.json()).data.draft;
  expect(draft.content).toEqual(preview.persona.content);
  const stored = await stack.owner.pool.query<{ bytes: number }>(
    'SELECT octet_length(payload::text) AS bytes FROM persona_imports WHERE id=$1',
    [preview.id],
  );
  expect(stored.rows[0]?.bytes).toBeGreaterThan(2 * 1024 * 1024);
  expect(stored.rows[0]?.bytes).toBeLessThanOrEqual(4 * 1024 * 1024);
});

it('转码后超过既有4MiB草稿存储预算明确拒绝且不留下半成品，后续仍可重试', async () => {
  const owner = await verifiedCreator(stack);
  // GBK的0x80是欧元字符，2MiB源文件可膨胀为约6MiB UTF-8正文
  const bytes = Buffer.from(
    JSON.stringify({
      system_prompt: 'prompt',
      begin_dialogs: Array.from({ length: 200 }, () => '\u0080'.repeat(10000)),
    }),
    'latin1',
  );
  expect(bytes.length).toBeLessThan(4 * 1024 * 1024);
  const response = await upload(owner.http, bytes, 'gbk');
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: 'INVALID_INPUT' } });
  const accountId = (await owner.http.context()).data.account?.id;
  if (!accountId) throw new Error('缺少已登录测试账号');
  const previews = await stack.owner.pool.query<{ value: number }>(
    'SELECT count(*)::int AS value FROM persona_imports WHERE owner_id=$1',
    [accountId],
  );
  expect(previews.rows[0]?.value).toBe(0);
  expect(
    (await upload(owner.http, Buffer.from('{"system_prompt":"small","begin_dialogs":[]}'))).status,
  ).toBe(200);
});

it('无法存储的空字符和孤立代理项返回明确输入错误而非数据库500', async () => {
  const owner = await verifiedCreator(stack);
  for (const value of ['x\0y', '\ud800']) {
    const response = await upload(
      owner.http,
      Buffer.from(JSON.stringify({ system_prompt: value, begin_dialogs: [] })),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_INPUT' } });
  }
});

it('预览临界值加来源资料后重新核验草稿预算，创建和CAS替换均原子失败且能改短重试', async () => {
  const owner = await verifiedCreator(stack);
  const makeSource = (extra: number) =>
    Buffer.from(
      JSON.stringify({
        system_prompt: 'prompt',
        begin_dialogs: Array.from({ length: 200 }, (_, index) =>
          '\u0080'.repeat(1 + Math.floor(extra / 200) + (index < extra % 200 ? 1 : 0)),
        ),
      }),
      'latin1',
    );
  const baseResponse = await upload(owner.http, makeSource(0), 'gbk');
  expect(baseResponse.status).toBe(200);
  const base = ImportPreviewResponseSchema.parse(await baseResponse.json()).data;
  const stored = await stack.owner.pool.query<{ bytes: number }>(
    'SELECT octet_length(payload::text) AS bytes FROM persona_imports WHERE id=$1',
    [base.id],
  );
  const baselineBytes = stored.rows[0]?.bytes;
  if (!baselineBytes) throw new Error('缺少真实预览字节数');
  const extra = Math.floor((4 * 1024 * 1024 - 2048 - baselineBytes) / 3);
  const response = await upload(owner.http, makeSource(extra), 'gbk');
  expect(response.status).toBe(200);
  const preview = ImportPreviewResponseSchema.parse(await response.json()).data;
  const confirm = {
    previewId: preview.id,
    contentHash: preview.contentHash,
    title: '边界来源确认',
    sourceDescription: '中'.repeat(2000),
    target: { mode: 'new' },
    confirmed: true,
  };
  expect((await owner.http.write('/api/v1/me/persona-imports/confirm', confirm)).status).toBe(400);
  const accountId = (await owner.http.context()).data.account?.id;
  if (!accountId) throw new Error('缺少当前账号');
  const count = await stack.owner.pool.query<{ total: number }>(
    'SELECT count(*)::int AS total FROM personas WHERE owner_id=$1',
    [accountId],
  );
  expect(count.rows[0]?.total).toBe(0);
  const initial = await owner.http.write('/api/v1/me/personas', {
    platform: 'astrbot',
    title: '目标草稿',
  });
  expect(initial.status).toBe(200);
  const target = DraftResponseSchema.parse(await initial.json());
  const replacement = {
    mode: 'replace',
    personaId: target.data.id,
    expectedRevision: target.meta.revision,
  };
  expect(
    (
      await owner.http.write('/api/v1/me/persona-imports/confirm', {
        ...confirm,
        target: replacement,
      })
    ).status,
  ).toBe(400);
  const unchanged = DraftResponseSchema.parse(
    await (await owner.http.raw('/api/v1/me/personas/' + target.data.id + '/draft')).json(),
  );
  expect(unchanged).toEqual(target);
  const retried = await owner.http.write('/api/v1/me/persona-imports/confirm', {
    ...confirm,
    sourceDescription: '较短的来源说明',
    target: replacement,
  });
  expect(retried.status).toBe(200);
  const saved = DraftResponseSchema.parse(await retried.json());
  expect(saved.data.id).toBe(target.data.id);
  expect(saved.meta.revision).toBe(target.meta.revision + 1);
  expect(saved.data.draft.content).toEqual(preview.persona.content);
});
