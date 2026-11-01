import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  TextImportSourceResponseSchema,
  ImportPreviewResponseSchema,
  DraftResponseSchema,
} from '@personamarket/contracts';
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
const sourcePath = '/api/v1/me/persona-imports/text/source/file';
const mappingPath = '/api/v1/me/persona-imports/text/preview';
async function headers(http: AuthHttp) {
  const context = await http.context();
  return {
    Origin: http.origin,
    'X-CSRF-Token': context.data.csrfToken,
    Cookie: [...http.cookies].map(([key, value]) => key + '=' + value).join('; '),
  };
}
async function upload(
  http: AuthHttp,
  bytes: Buffer,
  format = 'text-plain',
  encoding = 'auto',
  extraHeaders?: Record<string, string>,
) {
  const body = new FormData();
  body.set(
    'file',
    new Blob([Buffer.from(bytes)]),
    format === 'text-markdown' ? '原文.md' : '原文.txt',
  );
  return fetch(http.base + sourcePath + '?format=' + format + '&encoding=' + encoding, {
    method: 'POST',
    body,
    headers: extraHeaders ?? (await headers(http)),
    signal: AbortSignal.timeout(10000),
  });
}
const mapped = {
  format: 'text-plain',
  filename: '作者原文.txt',
  mapped: true,
  persona: {
    platform: 'maibot',
    content: { personality: '  人格\r\n原文  ', replyStyle: '自然表达', behaviorStyle: '尊重边界' },
  },
};

it('解码只返回当前用户的原文和实际编码，不执行Markdown、猜拆字段或保存完整文件', async () => {
  const owner = await verifiedCreator(stack);
  const marker = 'synthetic-unmapped-marker-never-persist';
  const prefix = Buffer.from('  # 人格\r\n<script>literal only</script>\n' + marker + '\n');
  const bytes = Buffer.concat([prefix, Buffer.alloc(4 * 1024 * 1024 - prefix.length, 0x20)]);
  const response = await upload(owner.http, bytes, 'text-markdown');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  const result = TextImportSourceResponseSchema.parse(await response.json()).data;
  expect(result.text).toBe(bytes.toString('utf8'));
  expect(result.filename).toBe('原文.md');
  expect(result.sourceEncoding).toEqual({ encoding: 'utf-8', determinedBy: 'utf8' });
  expect(result).not.toHaveProperty('persona');
  const accountId = (await owner.http.context()).data.account?.id;
  if (!accountId) throw new Error('缺少测试账号');
  const rows = await stack.owner.pool.query<{ total: number }>(
    'SELECT count(*)::int AS total FROM persona_imports WHERE owner_id=$1',
    [accountId],
  );
  expect(rows.rows[0]?.total).toBe(0);
  const previewResponse = await owner.http.write(mappingPath, mapped);
  expect(previewResponse.status).toBe(200);
  const preview = ImportPreviewResponseSchema.parse(await previewResponse.json()).data;
  expect(preview.persona).toEqual(mapped.persona);
  expect(preview.sourceEncoding).toBeUndefined();
  const stored = await stack.owner.pool.query<{ payload: unknown }>(
    'SELECT payload FROM persona_imports WHERE id=$1',
    [preview.id],
  );
  expect(JSON.stringify(stored.rows)).not.toContain(marker);
});

it('GBK/UTF16、超限/空文件/错误格式与CSRF均有真实结果，失败后仍可重试', async () => {
  const owner = await verifiedCreator(stack);
  expect((await upload(stack.browser(), Buffer.from('text'))).status).toBe(401);
  const authenticated = await headers(owner.http);
  expect(
    (
      await upload(owner.http, Buffer.from('text'), 'text-plain', 'auto', {
        Cookie: authenticated.Cookie,
        Origin: authenticated.Origin,
      })
    ).status,
  ).toBe(403);
  expect((await upload(owner.http, Buffer.from('text'), 'unknown')).status).toBe(400);
  expect((await upload(owner.http, Buffer.from('text'), 'text-plain', 'wrong')).status).toBe(400);
  expect((await upload(owner.http, Buffer.alloc(0))).status).toBe(422);
  expect((await upload(owner.http, Buffer.from('a\0b'))).status).toBe(422);
  expect((await upload(owner.http, Buffer.alloc(4 * 1024 * 1024 + 1, 0x20))).status).toBe(413);
  const gbk = await upload(owner.http, Buffer.from([32, 0xd6, 0xd0, 0xce, 0xc4, 32]));
  expect(gbk.status).toBe(200);
  expect(TextImportSourceResponseSchema.parse(await gbk.json()).data).toMatchObject({
    text: ' 中文 ',
    sourceEncoding: { encoding: 'gb18030', determinedBy: 'fallback' },
  });
  const utf16 = await upload(
    owner.http,
    Buffer.from('\ufeff  星光🌟\r\n末行  ', 'utf16le').swap16(),
  );
  expect(utf16.status).toBe(200);
  expect(TextImportSourceResponseSchema.parse(await utf16.json()).data).toMatchObject({
    text: '  星光🌟\r\n末行  ',
    sourceEncoding: { encoding: 'utf-16be', determinedBy: 'bom' },
  });
  expect((await upload(owner.http, Buffer.from('retry'))).status).toBe(200);
});

it('人工映射保持平台与成对对话边界，私有来源确认、哈希、过期和CAS仍由真实事务保护', async () => {
  const owner = await verifiedCreator(stack);
  const other = await verifiedCreator(stack);
  for (const invalid of [
    { ...mapped, mapped: false },
    { ...mapped, role: 'admin' },
    {
      ...mapped,
      persona: { platform: 'maibot', content: { ...mapped.persona.content, replyStyle: ' ' } },
    },
    { ...mapped, sourceEncoding: { encoding: 'utf-8', determinedBy: 'bom' } },
  ])
    expect((await owner.http.write(mappingPath, invalid)).status).toBe(400);
  const pair = { id: randomUUID(), user: '  问\r\n原文  ', assistant: '  答\n原文  ' };
  const input = {
    format: 'text-markdown',
    filename: '人格.md',
    mapped: true,
    persona: {
      platform: 'astrbot',
      content: { systemPrompt: '  明确选择的人格  ', dialoguePairs: [pair] },
    },
  };
  const response = await owner.http.write(mappingPath, input);
  expect(response.status).toBe(200);
  const preview = ImportPreviewResponseSchema.parse(await response.json()).data;
  expect(preview.format).toBe('text-markdown');
  if (preview.persona.platform !== 'astrbot') throw new Error('错误的平台');
  expect(preview.persona.content.systemPrompt).toBe(input.persona.content.systemPrompt);
  expect(preview.persona.content.dialoguePairs[0]).toMatchObject({
    user: pair.user,
    assistant: pair.assistant,
  });
  expect(preview.persona.content.dialoguePairs[0]?.id).not.toBe(pair.id);
  const confirm = {
    previewId: preview.id,
    contentHash: preview.contentHash,
    title: '手动映射私有草稿',
    sourceDescription: '作者提供的Markdown，仅映射明确选择的文本',
    target: { mode: 'new' },
    confirmed: true,
  };
  expect((await other.http.write('/api/v1/me/persona-imports/confirm', confirm)).status).toBe(404);
  const changedHash = await owner.http.write('/api/v1/me/persona-imports/confirm', {
    ...confirm,
    contentHash: '0'.repeat(64),
  });
  expect(changedHash.status).toBe(409);
  expect(await changedHash.json()).toMatchObject({ error: { code: 'CONFLICT' } });
  const saved = await owner.http.write('/api/v1/me/persona-imports/confirm', confirm);
  expect(saved.status).toBe(200);
  const draft = DraftResponseSchema.parse(await saved.json());
  expect(draft.data.draft.content).toEqual(preview.persona.content);
  expect(draft.data.draft.origin).toMatchObject({
    type: 'repost',
    sourceDescription: confirm.sourceDescription,
  });
  expect(draft.data.draft.rightsAccepted).toBe(false);
  const repeated = await owner.http.write('/api/v1/me/persona-imports/confirm', confirm);
  expect(repeated.status).toBe(200);
  expect(DraftResponseSchema.parse(await repeated.json()).data.id).toBe(draft.data.id);
  const replacement = await owner.http.write(mappingPath, input);
  const next = ImportPreviewResponseSchema.parse(await replacement.json()).data;
  const staleRevision = await owner.http.write('/api/v1/me/persona-imports/confirm', {
    ...confirm,
    previewId: next.id,
    contentHash: next.contentHash,
    target: {
      mode: 'replace',
      personaId: draft.data.id,
      expectedRevision: draft.meta.revision + 1,
    },
  });
  expect(staleRevision.status).toBe(412);
  expect(await staleRevision.json()).toMatchObject({ error: { code: 'REVISION_CONFLICT' } });
  await stack.owner.pool.query(
    "UPDATE persona_imports SET expires_at=now()-interval '1 minute' WHERE id=$1",
    [next.id],
  );
  expect(
    (
      await owner.http.write('/api/v1/me/persona-imports/confirm', {
        ...confirm,
        previewId: next.id,
        contentHash: next.contentHash,
      })
    ).status,
  ).toBe(409);
});
