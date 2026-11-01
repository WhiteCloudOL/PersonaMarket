import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { DraftResponseSchema, ImportPreviewResponseSchema } from '@personamarket/contracts';
import { serializeMaiBot, serializeAstrBot } from '@personamarket/persona-adapters';
import { pruneImportPreviews } from '@personamarket/server';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator, completePersona } from '../fixtures/creator.js';
let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeAll(async () => {
  stack = await createAuthStack();
});
afterAll(async () => {
  await stack?.close();
});
it('真实原生预览与幂等确认，严格隔离身份、平台、版本和来源', async () => {
  const owner = await verifiedCreator(stack);
  const other = await verifiedCreator(stack);
  const existing = await completePersona(owner.http);
  const astrExisting = await completePersona(owner.http, 'astrbot');
  const input = {
    format: 'maibot-toml',
    filename: '人格.toml',
    source:
      serializeMaiBot({
        platform: 'maibot',
        content: {
          personality: '  人格原文\n第二行  ',
          replyStyle: '带有 "引号" 与反斜杠 \\',
          behaviorStyle: '尊重边界',
        },
      }) + '\n[account]\npassword="fixture-secret-never-store"\n',
  };
  const preview = async (body = input) =>
    ImportPreviewResponseSchema.parse(
      await (await owner.http.write('/api/v1/me/persona-imports/preview', body)).json(),
    ).data;
  const data = await preview();
  expect(data.ignoredFields).toContain('account');
  expect(data.persona.platform).toBe('maibot');
  expect(
    (await stack.owner.pool.query('SELECT count(*)::integer AS total FROM personas')).rows[0]?.[
      'total'
    ],
  ).toBe(2);
  expect(
    JSON.stringify(
      (await stack.owner.pool.query('SELECT payload FROM persona_imports WHERE id=$1', [data.id]))
        .rows,
    ),
  ).not.toContain('fixture-secret-never-store');
  const confirm = {
    previewId: data.id,
    contentHash: data.contentHash,
    title: '导入的人格',
    sourceDescription: '来自作者原始文件，待补充许可',
    target: { mode: 'new' },
    confirmed: true,
  };
  expect((await other.http.write('/api/v1/me/persona-imports/confirm', confirm)).status).toBe(404);
  expect(
    (
      await owner.http.write('/api/v1/me/persona-imports/confirm', {
        ...confirm,
        contentHash: '0'.repeat(64),
      })
    ).status,
  ).toBe(409);
  const responses = await Promise.all([
    owner.http.write('/api/v1/me/persona-imports/confirm', confirm),
    owner.http.write('/api/v1/me/persona-imports/confirm', confirm),
  ]);
  expect(responses.map((item) => item.status)).toEqual([200, 200]);
  const imported = await Promise.all(
    responses.map(async (item) => DraftResponseSchema.parse(await item.json())),
  );
  expect(imported[0]?.data.id).toBe(imported[1]?.data.id);
  expect(imported[0]?.data.draft.content).toEqual(data.persona.content);
  expect(imported[0]?.data.draft.origin).toMatchObject({
    type: 'repost',
    originalAuthor: '',
    sourceDescription: confirm.sourceDescription,
  });
  expect(imported[0]?.data.draft.rightsAccepted).toBe(false);
  expect(
    (
      await owner.http.write('/api/v1/me/persona-imports/confirm', {
        ...confirm,
        title: '篡改确认参数',
      })
    ).status,
  ).toBe(409);
  const another = await preview();
  const replace = {
    ...confirm,
    previewId: another.id,
    contentHash: another.contentHash,
    target: { mode: 'replace', personaId: existing.id, expectedRevision: 1 },
  };
  expect((await owner.http.write('/api/v1/me/persona-imports/confirm', replace)).status).toBe(412);
  expect(
    (
      await owner.http.write('/api/v1/me/persona-imports/confirm', {
        ...replace,
        target: { mode: 'replace', personaId: astrExisting.id, expectedRevision: 2 },
      })
    ).status,
  ).toBe(400);
  const replacement = await owner.http.write('/api/v1/me/persona-imports/confirm', {
    ...replace,
    target: { ...replace.target, expectedRevision: 2 },
  });
  expect(replacement.status).toBe(200);
  expect(DraftResponseSchema.parse(await replacement.json()).meta.revision).toBe(3);
  const astr = await preview({
    format: 'astrbot-json',
    filename: '人格.json',
    source: serializeAstrBot(
      {
        platform: 'astrbot',
        content: {
          systemPrompt: '  保留原文  ',
          dialoguePairs: [{ id: randomUUID(), user: '你好', assistant: '欢迎来到林间' }],
        },
      },
      '测试人格',
    ),
  });
  const astrImported = await owner.http.write('/api/v1/me/persona-imports/confirm', {
    ...confirm,
    previewId: astr.id,
    contentHash: astr.contentHash,
  });
  expect(astrImported.status).toBe(200);
  expect(DraftResponseSchema.parse(await astrImported.json()).data.draft.content).toEqual(
    astr.persona.content,
  );
  const expired = await preview();
  await stack.owner.pool.query(
    "UPDATE persona_imports SET expires_at=now()-interval '1 second' WHERE id=$1",
    [expired.id],
  );
  expect(
    (
      await owner.http.write('/api/v1/me/persona-imports/confirm', {
        ...confirm,
        previewId: expired.id,
        contentHash: expired.contentHash,
      })
    ).status,
  ).toBe(409);
  expect(await pruneImportPreviews(stack.owner)).toBe(1);
  expect(
    (
      await stack.owner.pool.query(
        'SELECT count(*)::integer AS total FROM persona_imports WHERE id=$1',
        [expired.id],
      )
    ).rows[0]?.['total'],
  ).toBe(0);
  expect(
    (
      await owner.http.write('/api/v1/me/persona-imports/preview', {
        format: 'astrbot-json',
        filename: 'bad.json',
        source: JSON.stringify({ system_prompt: '原文', begin_dialogs: ['单条'] }),
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await owner.http.write('/api/v1/me/persona-imports/preview', {
        ...input,
        filename: '../bad.toml',
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await owner.http.raw('/api/v1/me/persona-imports/preview', {
        method: 'POST',
        body: JSON.stringify(input),
      })
    ).status,
  ).toBe(403);
  expect((await stack.browser().write('/api/v1/me/persona-imports/preview', input)).status).toBe(
    401,
  );
});
