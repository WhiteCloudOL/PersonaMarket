import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  AssetResponseSchema,
  DraftResponseSchema,
  MyPersonasResponseSchema,
  emptyPersonaDraft,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator } from '../fixtures/creator.js';
import { fixturePng } from '../fixtures/image.js';
import type { AuthHttp } from '../fixtures/auth-http.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeAll(async () => {
  stack = await createAuthStack();
});
afterAll(async () => {
  await stack?.close();
});

async function upload(http: AuthHttp, purpose: 'content' | 'evidence') {
  const context = await http.context();
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(fixturePng)], { type: 'image/png' }), 'fixture.png');
  const response = await fetch(http.base + '/api/v1/me/assets/upload/' + purpose, {
    method: 'POST',
    headers: {
      Cookie: [...http.cookies].map(([key, value]) => key + '=' + value).join('; '),
      Origin: http.origin,
      'X-CSRF-Token': context.data.csrfToken,
    },
    body: form,
    signal: AbortSignal.timeout(10000),
  });
  expect(response.status).toBe(200);
  return AssetResponseSchema.parse(await response.json()).data.id;
}

it('创建时原子保存两平台完整正文、元数据和自己的私有素材引用', async () => {
  const author = await verifiedCreator(stack);
  const content = await upload(author.http, 'content');
  const evidence = await upload(author.http, 'evidence');
  for (const platform of ['maibot', 'astrbot'] as const) {
    const initialDraft = {
      ...emptyPersonaDraft(platform, '星光书房'),
      summary: '  中文与空白原样保留  ',
      recommendedModels: [{ modelId: 'author/model', note: '创作建议' }],
      readmeMarkdown: '# 角色的故事\n\n![封面](asset://' + content + ')',
      avatarAssetId: content,
      coverAssetId: content,
      evidenceAssetIds: [evidence],
      authorNotes: '暂存不意味着已经发布',
    };
    if (initialDraft.platform === 'maibot') initialDraft.content.personality = '  书房中的角色\n  ';
    else
      initialDraft.content.dialoguePairs = [
        { id: randomUUID(), user: '你好', assistant: '欢迎回来' },
      ];
    const response = await author.http.write('/api/v1/me/personas', {
      platform,
      title: initialDraft.title,
      initialDraft,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const created = DraftResponseSchema.parse(await response.json());
    expect(created.meta.revision).toBe(1);
    expect(created.data.draft).toEqual(initialDraft);
    expect(
      DraftResponseSchema.parse(
        await (await author.http.raw('/api/v1/me/personas/' + created.data.id + '/draft')).json(),
      ),
    ).toEqual(created);
    const references = await stack.owner.pool.query(
      'SELECT asset_id, purpose FROM asset_references WHERE resource_type=$1 AND resource_id=$2',
      ['draft', created.data.id],
    );
    expect(references.rows).toHaveLength(2);
    expect(references.rows).toEqual(
      expect.arrayContaining([
        { asset_id: content, purpose: 'content' },
        { asset_id: evidence, purpose: 'evidence' },
      ]),
    );
    expect((await stack.browser().raw('/api/v1/public/assets/' + content)).status).toBe(404);
    expect((await stack.browser().raw('/api/v1/public/assets/' + evidence)).status).toBe(404);
    expect(
      (
        await stack.owner.pool.query('SELECT published_release_id FROM personas WHERE id=$1', [
          created.data.id,
        ])
      ).rows,
    ).toEqual([{ published_release_id: null }]);
  }
});

it('初始素材越权、证据用途混用和缺失素材失败时不遗留半成品人设', async () => {
  const author = await verifiedCreator(stack);
  const stranger = await verifiedCreator(stack);
  const foreign = await upload(stranger.http, 'content');
  const proof = await upload(author.http, 'evidence');
  for (const id of [foreign, proof, randomUUID()]) {
    const initialDraft = { ...emptyPersonaDraft('maibot', '原子回滚'), coverAssetId: id };
    expect(
      (
        await author.http.write('/api/v1/me/personas', {
          platform: 'maibot',
          title: initialDraft.title,
          initialDraft,
        })
      ).status,
    ).toBe(400);
    expect(
      MyPersonasResponseSchema.parse(await (await author.http.raw('/api/v1/me/personas')).json())
        .meta.total,
    ).toBe(0);
  }
  expect(
    (
      await stack.browser().write('/api/v1/me/personas', {
        platform: 'maibot',
        title: '匿名请求',
        initialDraft: emptyPersonaDraft('maibot', '匿名请求'),
      })
    ).status,
  ).toBe(401);
});
