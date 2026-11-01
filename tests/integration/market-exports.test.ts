import { randomUUID } from 'node:crypto';
import { rename } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { crc32 } from 'node:zlib';
import { fromBufferPromise } from 'yauzl';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  AssetResponseSchema,
  DraftResponseSchema,
  ExportPreviewResponseSchema,
  SubmissionResponseSchema,
  TaxonomyResponseSchema,
  type PersonaDraft,
} from '@personamarket/contracts';
import { parseMarketPersona } from '@personamarket/persona-adapters';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { completePersona, verifiedCreator } from '../fixtures/creator.js';
import type { AuthHttp } from '../fixtures/auth-http.js';
import { fixturePng } from '../fixtures/image.js';
let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeAll(async () => {
  stack = await createAuthStack();
});
afterAll(async () => {
  await stack?.close();
});
async function readArchive(bytes: Buffer) {
  const archive = await fromBufferPromise(bytes, {
    lazyEntries: true,
    strictFileNames: true,
    validateEntrySizes: true,
  });
  const files = new Map<string, Buffer>();
  try {
    for await (const entry of archive.eachEntry()) {
      const parts: Uint8Array[] = [];
      for await (const chunk of await archive.openReadStreamPromise(entry)) {
        if (!(chunk instanceof Uint8Array)) throw new Error('错误的归档字节');
        parts.push(chunk);
      }
      const content = Buffer.concat(parts);
      expect(crc32(content)).toBe(entry.crc32);
      files.set(entry.fileName, content);
    }
  } finally {
    archive.close();
  }
  return files;
}

async function upload(http: AuthHttp, purpose: 'content' | 'evidence') {
  const context = await http.context();
  const body = new FormData();
  body.set('file', new Blob([fixturePng], { type: 'image/png' }), 'fixture.png');
  const response = await fetch(http.base + '/api/v1/me/assets/upload/' + purpose, {
    method: 'POST',
    body,
    headers: {
      Origin: http.origin,
      'X-CSRF-Token': context.data.csrfToken,
      Cookie: [...http.cookies].map(([name, value]) => name + '=' + value).join('; '),
    },
    signal: AbortSignal.timeout(10000),
  });
  expect(response.status).toBe(200);
  return AssetResponseSchema.parse(await response.json()).data;
}

it('通用JSON与Markdown绑定已审历史版本，完整迁移资料且隔离私有证据与后续草稿', async () => {
  const author = await verifiedCreator(stack);
  const admin = await stack.admin();
  const visitor = stack.browser();
  const taxonomy = TaxonomyResponseSchema.parse(
    await (await visitor.raw('/api/v1/site/taxonomy')).json(),
  ).data;
  const category = taxonomy.categories[0];
  if (!category) throw new Error('缺少分类');
  const image = await upload(author.http, 'content');
  const proof = await upload(author.http, 'evidence');
  const created = await completePersona(author.http);
  const draft: PersonaDraft = {
    ...created.draft,
    title: '星光书房 🪄',
    summary: '冻结的公开简介',
    categoryId: category.id,
    tagIds: taxonomy.tags.slice(0, 2).map((tag) => tag.id),
    avatarAssetId: image.id,
    coverAssetId: image.id,
    evidenceAssetIds: [proof.id],
    readmeMarkdown: `# 作者原文  \n\n![图](asset://${image.id})\n\n\`asset://仅为代码\``,
    authorNotes: '  原样保留使用说明  ',
    recommendedModels: [{ modelId: 'author/model', note: '模型说明' }],
    origin: {
      type: 'repost',
      redistribution: 'custom',
      policyText: '保留署名，先联系原作者',
      originalAuthor: '公开原作者',
      sourceUrl: 'https://example.org/original',
      sourceDescription: '可核查来源',
      authorizationStatement: '本例许可声明',
    },
    platform: 'maibot',
    content: {
      personality: '  人格原文\n```原样反引号```  ',
      replyStyle: '自然表达',
      behaviorStyle: '尊重边界',
    },
  };
  const save = async (value: PersonaDraft, revision: number) => {
    const response = await author.http.write(
      `/api/v1/me/personas/${created.id}/draft`,
      value,
      'PUT',
      { 'If-Match': `"draft-${revision}"` },
    );
    expect(response.status).toBe(200);
    return DraftResponseSchema.parse(await response.json());
  };
  const publish = async (version: string, revision: number) => {
    const submitted = await author.http.write(
      `/api/v1/me/personas/${created.id}/releases`,
      {
        version,
        expectedDraftRevision: revision,
        changelog: '冻结版本 ' + version,
        confirmed: true,
      },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(submitted.status).toBe(200);
    const submission = SubmissionResponseSchema.parse(await submitted.json()).data;
    expect(
      (
        await admin.http.write(
          `/api/v1/admin/moderation/submissions/${submission.id}/review`,
          {
            action: 'approve',
            expectedRevision: submission.revision,
            reason: '核对版本和图片',
            selfReviewConfirmed: false,
          },
          'POST',
          { 'Idempotency-Key': randomUUID() },
        )
      ).status,
    ).toBe(200);
    return submission.releaseId;
  };
  const saved = await save(draft, 2);
  const first = await publish('1.0.0', saved.meta.revision);
  const secondDraft = { ...draft, title: '第二个公开版本', summary: '已审第二版' };
  const next = await save(secondDraft, saved.meta.revision);
  const second = await publish('1.1.0', next.meta.revision);
  await save(
    { ...secondDraft, title: '私有未公开标题', readmeMarkdown: '私有未公开正文' },
    next.meta.revision,
  );

  for (const [releaseId, expected, version] of [
    [first, draft, '1.0.0'],
    [second, secondDraft, '1.1.0'],
  ] as const) {
    const base = `/api/v1/personas/${created.id}/releases/${releaseId}`;
    const response = await visitor.raw(base + '/export-preview?format=market-json');
    expect(response.status).toBe(200);
    const preview = ExportPreviewResponseSchema.parse(await response.json()).data;
    expect(preview.filename).toMatch(/\.persona\.json$/);
    const document = parseMarketPersona(Buffer.from(preview.text), 'json');
    expect(document.metadata).toMatchObject({
      title: expected.title,
      summary: expected.summary,
      categoryName: category.name,
      tagNames: taxonomy.tags.slice(0, 2).map((tag) => tag.name),
      readmeMarkdown: expected.readmeMarkdown,
      recommendedModels: expected.recommendedModels,
      authorNotes: expected.authorNotes,
      origin: expected.origin,
      avatarKey: image.id,
      coverKey: image.id,
    });
    expect(document.content).toEqual(expected.content);
    expect(document.assets).toEqual([
      {
        key: image.id,
        mimeType: image.mime,
        bytes: image.bytes,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        url: expect.stringContaining('/api/v1/public/assets/' + image.id),
      },
    ]);
    expect(document.source).toMatchObject({
      version,
      changelog: '冻结版本 ' + version,
      publisherName: author.username,
      personaUrl: expect.stringContaining(`/personas/${created.id}/releases/${releaseId}`),
    });
    expect(preview.text).not.toContain(proof.id);
    expect(preview.text).not.toContain('私有未公开');
    expect(document.metadata).not.toHaveProperty('categoryId');
    expect(document.metadata).not.toHaveProperty('tagIds');
    const download = await visitor.raw(base + '/export?format=market-json');
    expect(download.status).toBe(200);
    expect(download.headers.get('cache-control')).toBe('private, no-store');
    expect(download.headers.get('content-type')).toContain('application/json');
    expect(download.headers.get('content-disposition')).toContain("filename*=UTF-8''");
    expect(await download.text()).toBe(preview.text);
    const markdown = await visitor.raw(base + '/export?format=markdown');
    expect(markdown.status).toBe(200);
    expect(markdown.headers.get('content-type')).toContain('text/markdown');
    const text = await markdown.text();
    expect(text).toContain('人格设定');
    expect(text).toContain(draft.content.personality);
    expect(text).toContain(draft.content.replyStyle);
    expect(text).toContain(draft.content.behaviorStyle);
    expect(text).not.toContain('私有未公开');
    const archivePreviewResponse = await visitor.raw(base + '/export-preview?format=market-zip');
    expect(archivePreviewResponse.status).toBe(200);
    const archivePreview = ExportPreviewResponseSchema.parse(
      await archivePreviewResponse.json(),
    ).data;
    expect(archivePreview.filename).toMatch(/\.persona\.zip$/);
    const zip = await visitor.raw(base + '/export?format=market-zip');
    expect(zip.status).toBe(200);
    expect(zip.headers.get('content-type')).toBe('application/zip');
    expect(zip.headers.get('cache-control')).toBe('private, no-store');
    const files = await readArchive(Buffer.from(await zip.arrayBuffer()));
    const manifest = files.get('persona.json');
    if (!manifest) throw new Error('归档缺少清单');
    const portable = parseMarketPersona(manifest, 'zip');
    expect(manifest.toString()).toBe(archivePreview.text);
    expect(portable.metadata.title).toBe(expected.title);
    expect(portable.metadata.readmeMarkdown).toBe(
      expected.readmeMarkdown.replace(`asset://${image.id}`, `assets/${image.id}.webp`),
    );
    expect(files.get('README.md')?.toString()).toBe(portable.metadata.readmeMarkdown);
    expect(files.get('LICENSE.txt')?.toString()).toContain('公开原作者');
    expect(files.get('LICENSE.txt')?.toString()).not.toContain('AGPL');
    expect([...files.keys()]).toEqual([
      'persona.json',
      'README.md',
      'LICENSE.txt',
      `assets/${image.id}.webp`,
    ]);
    expect(files.get(`assets/${image.id}.webp`)?.byteLength).toBe(image.bytes);
    expect(files.get(`assets/${image.id}.webp`)?.toString()).not.toContain('private metadata');
    expect(manifest.toString()).not.toContain(proof.id);
    if (releaseId === first) {
      const root = resolve(stack.env.STORAGE_ROOT);
      if (!root.startsWith(resolve('data/tests') + sep)) throw new Error('测试存储不在隔离目录');
      const row = await stack.owner.pool.query('SELECT storage_key FROM assets WHERE id=$1', [
        image.id,
      ]);
      const key: unknown = row.rows[0]?.['storage_key'];
      if (typeof key !== 'string' || !/^[a-f0-9]{32}\.webp$/.test(key))
        throw new Error('错误的测试存储键');
      const original = join(root, key);
      const backup = join(root, key + '.test-backup');
      await rename(original, backup);
      try {
        const previous = await stack.owner.pool.query(
          'SELECT coalesce(sum(total_count),0)::text AS total FROM export_daily_metrics WHERE persona_id=$1',
          [created.id],
        );
        const missing = await stack.browser().raw(base + '/export?format=market-zip');
        expect(missing.status).toBe(404);
        expect(missing.headers.get('content-disposition')).toBeNull();
        const after = await stack.owner.pool.query(
          'SELECT coalesce(sum(total_count),0)::text AS total FROM export_daily_metrics WHERE persona_id=$1',
          [created.id],
        );
        expect(after.rows).toEqual(previous.rows);
      } finally {
        await rename(backup, original);
      }
    }
  }
  expect((await visitor.raw('/api/v1/public/assets/' + proof.id)).status).toBe(404);
  expect(
    (
      await author.http.write(`/api/v1/me/personas/${created.id}/visibility`, {
        visibility: 'hidden',
        reason: '作者隐藏后不得继续导出',
      })
    ).status,
  ).toBe(200);
  for (const format of ['market-json', 'markdown', 'market-zip'])
    expect(
      (
        await visitor.raw(
          `/api/v1/personas/${created.id}/releases/${first}/export?format=${format}`,
        )
      ).status,
    ).toBe(404);
});

it('AstrBot通用导出保留成对顺序与原始人格空白，排除站内对话行ID', async () => {
  const author = await verifiedCreator(stack);
  const admin = await stack.admin();
  const visitor = stack.browser();
  const created = await completePersona(author.http, 'astrbot');
  const taxonomy = TaxonomyResponseSchema.parse(
    await (await visitor.raw('/api/v1/site/taxonomy')).json(),
  ).data;
  const category = taxonomy.categories[0];
  if (!category) throw new Error('缺少分类');
  const dialoguePairs = [
    { id: randomUUID(), user: '  第一句  ', assistant: '第一答\n第二行' },
    { id: randomUUID(), user: '第二句', assistant: '<script>只是作者文本</script>' },
  ];
  const systemPrompt = '  人格首尾保留\n  ';
  expect(
    (
      await author.http.write(
        `/api/v1/me/personas/${created.id}/draft`,
        {
          ...created.draft,
          categoryId: category.id,
          platform: 'astrbot',
          content: { systemPrompt, dialoguePairs },
        },
        'PUT',
        { 'If-Match': '"draft-2"' },
      )
    ).status,
  ).toBe(200);
  const submitted = await author.http.write(
    `/api/v1/me/personas/${created.id}/releases`,
    { version: '1.0.0', expectedDraftRevision: 3, changelog: '确认人格与对话', confirmed: true },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(submitted.status).toBe(200);
  const submission = SubmissionResponseSchema.parse(await submitted.json()).data;
  expect(
    (
      await admin.http.write(
        `/api/v1/admin/moderation/submissions/${submission.id}/review`,
        {
          action: 'approve',
          expectedRevision: submission.revision,
          reason: '核对成对对话',
          selfReviewConfirmed: false,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  const base = `/api/v1/personas/${created.id}/releases/${submission.releaseId}`;
  const response = await visitor.raw(base + '/export?format=market-json');
  expect(response.status).toBe(200);
  const source = await response.text();
  const document = parseMarketPersona(Buffer.from(source), 'json');
  expect(document.content).toEqual({
    systemPrompt,
    dialoguePairs: dialoguePairs.map(({ user, assistant }) => ({ user, assistant })),
  });
  for (const pair of dialoguePairs) expect(source).not.toContain(pair.id);
  const markdown = await visitor.raw(base + '/export?format=markdown');
  expect(markdown.status).toBe(200);
  const text = await markdown.text();
  expect(text).toContain(systemPrompt);
  expect(text.indexOf('第一句')).toBeLessThan(text.indexOf('第一答'));
  expect(text.indexOf('第一答')).toBeLessThan(text.indexOf('第二句'));
  expect(text).toContain('```text\n<script>只是作者文本</script>\n```');
  const archiveResponse = await visitor.raw(base + '/export?format=market-zip');
  expect(archiveResponse.status).toBe(200);
  const files = await readArchive(Buffer.from(await archiveResponse.arrayBuffer()));
  expect([...files.keys()]).toEqual(['persona.json', 'README.md', 'LICENSE.txt']);
  const manifest = files.get('persona.json');
  if (!manifest) throw new Error('归档缺少清单');
  expect(parseMarketPersona(manifest, 'zip').content).toEqual(document.content);
});
