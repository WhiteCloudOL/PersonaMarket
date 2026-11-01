import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  MarketImportPreviewResponseSchema,
  DraftResponseSchema,
  MarketPersonaSchema,
  MarketImportImageListResponseSchema,
  type MarketImportPreview,
} from '@personamarket/contracts';
import { createMarketArchive } from '@personamarket/persona-adapters';
import { LocalStorage, pruneMarketImports, storeImage } from '@personamarket/server';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator } from '../fixtures/creator.js';
import type { AuthHttp } from '../fixtures/auth-http.js';
import { marketPersona } from '../fixtures/market-personas.js';
import { fixturePng } from '../fixtures/image.js';
import { completePersona } from '../fixtures/creator.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeAll(async () => {
  stack = await createAuthStack();
});
afterAll(async () => {
  await stack?.close();
});
async function upload(
  http: AuthHttp,
  bytes: Uint8Array,
  filename: string,
  path = '/api/v1/me/market-imports/preview',
) {
  const context = await http.context();
  const body = new FormData();
  body.set('file', new Blob([Buffer.from(bytes)]), filename);
  return fetch(http.base + path, {
    method: 'POST',
    body,
    headers: {
      Origin: http.origin,
      'X-CSRF-Token': context.data.csrfToken,
      Cookie: [...http.cookies].map(([name, value]) => name + '=' + value).join('; '),
    },
    signal: AbortSignal.timeout(15000),
  });
}
it('通用JSON只预览私有资料，确认后原子创建本人草稿并保留来源', async () => {
  const owner = await verifiedCreator(stack);
  const other = await verifiedCreator(stack);
  const document = marketPersona();
  const response = await upload(
    owner.http,
    Buffer.from(JSON.stringify(document)),
    '角色.persona.json',
  );
  expect(response.status).toBe(200);
  const preview = MarketImportPreviewResponseSchema.parse(await response.json()).data;
  expect(preview.draft.title).toBe(document.metadata.title);
  expect(preview.filename).toBe('角色.persona.json');
  expect(preview.draft.content).toEqual(document.content);
  expect(preview.draft.rightsAccepted).toBe(false);
  const confirm = {
    previewId: preview.id,
    contentHash: preview.contentHash,
    title: document.metadata.title,
    sourceDescription: '原作者公开分享的文件，已核实来源',
    authorizationStatement:
      document.metadata.origin.type === 'repost'
        ? document.metadata.origin.authorizationStatement
        : '作者已授权此次转载',
    target: { mode: 'new' },
    confirmed: true,
  };
  expect((await other.http.write('/api/v1/me/market-imports/confirm', confirm)).status).toBe(404);
  const saved = await owner.http.write('/api/v1/me/market-imports/confirm', confirm);
  expect(saved.status).toBe(200);
  const draft = DraftResponseSchema.parse(await saved.json());
  expect(draft.data.draft.content).toEqual(document.content);
  expect(draft.data.draft.recommendedModels).toEqual(document.metadata.recommendedModels);
  expect(draft.data.draft.origin).toMatchObject({
    type: 'repost',
    originalAuthor: '原作者',
    redistribution: 'attribution_required',
    sourceUrl: 'https://example.org/original',
  });
  expect(draft.data.ownerVisibility).toBe('listed');
  expect((await other.http.raw('/api/v1/me/personas/' + draft.data.id + '/draft')).status).toBe(
    404,
  );
});

const packageKey = '3cabba2c-340d-4edb-8357-a1404f6f878a';
function imageDocument(url?: string, mimeType: 'image/png' | 'image/jpeg' = 'image/png') {
  const original = marketPersona();
  const path = `assets/${packageKey}.${mimeType === 'image/png' ? 'png' : 'jpg'}`;
  return MarketPersonaSchema.parse({
    ...original,
    metadata: {
      ...original.metadata,
      avatarKey: packageKey,
      coverKey: packageKey,
      readmeMarkdown: `# 原文  \n![图](${url ? `asset://${packageKey}` : path})\n\n\`assets/代码不替换.png\``,
    },
    assets: [
      {
        key: packageKey,
        ...(url ? { url } : { path }),
        mimeType,
        bytes: fixturePng.length,
        sha256: createHash('sha256').update(fixturePng).digest('hex'),
      },
    ],
  });
}
async function zipBytes(mimeType: 'image/png' | 'image/jpeg' = 'image/png') {
  const chunks: Uint8Array[] = [];
  for await (const chunk of createMarketArchive(
    imageDocument(undefined, mimeType),
    async () => fixturePng,
    new Date(),
  )) {
    if (!(chunk instanceof Uint8Array)) throw new Error('错误fixture流');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function confirmation(preview: MarketImportPreview) {
  return {
    previewId: preview.id,
    contentHash: preview.contentHash,
    title: '导入的星光角色',
    sourceDescription: '来自原作者公开文件，已核实来源',
    authorizationStatement: '原作者允许署名转载，保留原声明',
    target: { mode: 'new' },
    confirmed: true,
  };
}
it('完整ZIP逐图解码去元数据，私有暂存、失败回滚、文件完整性与并发确认保持一致', async () => {
  const owner = await verifiedCreator(stack);
  const other = await verifiedCreator(stack);
  const foreign = await completePersona(other.http);
  const source = await zipBytes();
  const response = await upload(owner.http, source, '星光.persona.zip');
  expect(response.status).toBe(200);
  const preview = MarketImportPreviewResponseSchema.parse(await response.json()).data;
  const image = preview.images[0];
  if (!image) throw new Error('缺少图片');
  expect(image.id).not.toBe(packageKey);
  expect(image.status).toBe('ready');
  expect(preview.draft.readmeMarkdown).toContain(`asset://${image.id}`);
  expect(preview.draft.readmeMarkdown).toContain('`assets/代码不替换.png`');
  const endpoint = `/api/v1/me/market-imports/${preview.id}/images/${image.id}`;
  expect((await other.http.raw(endpoint)).status).toBe(404);
  expect((await owner.http.raw('/api/v1/me/assets/' + image.id)).status).toBe(404);
  expect((await owner.http.raw('/api/v1/public/assets/' + image.id)).status).toBe(404);
  const picture = await owner.http.raw(endpoint);
  expect(picture.status).toBe(200);
  expect(picture.headers.get('content-type')).toContain('image/webp');
  expect(picture.headers.get('cache-control')).toContain('no-store');
  const normalized = Buffer.from(await picture.arrayBuffer());
  expect(normalized.toString()).not.toContain('private metadata');
  const confirm = confirmation(preview);
  expect(
    (
      await owner.http.write('/api/v1/me/market-imports/confirm', {
        ...confirm,
        target: { mode: 'replace', personaId: foreign.id, expectedRevision: 2 },
      })
    ).status,
  ).toBe(404);
  expect((await owner.http.raw('/api/v1/me/assets/' + image.id)).status).toBe(404);
  const stored = await stack.owner.pool.query<{ storage_key: string }>(
    'SELECT storage_key FROM market_import_assets WHERE id=$1',
    [image.id],
  );
  const key = stored.rows[0]?.storage_key;
  if (!key) throw new Error('缺少隔离素材键');
  const storage = new LocalStorage(stack.env.STORAGE_ROOT);
  await storage.delete(key);
  try {
    expect((await owner.http.write('/api/v1/me/market-imports/confirm', confirm)).status).toBe(404);
  } finally {
    await storage.put(key, normalized);
  }
  const concurrent = await Promise.all([
    owner.http.write('/api/v1/me/market-imports/confirm', confirm),
    owner.http.write('/api/v1/me/market-imports/confirm', confirm),
  ]);
  expect(concurrent.map((result) => result.status)).toEqual([200, 200]);
  const drafts = await Promise.all(
    concurrent.map(async (result) => DraftResponseSchema.parse(await result.json())),
  );
  expect(drafts[0]?.data.id).toBe(drafts[1]?.data.id);
  expect(drafts[0]?.data.draft.avatarAssetId).toBe(image.id);
  expect(drafts[0]?.data.draft.rightsAccepted).toBe(false);
  expect((await owner.http.raw('/api/v1/me/assets/' + image.id)).status).toBe(200);
  expect((await owner.http.raw('/api/v1/public/assets/' + image.id)).status).toBe(404);
  expect(
    (await stack.owner.pool.query('SELECT 1 FROM market_import_assets WHERE id=$1', [image.id]))
      .rowCount,
  ).toBe(0);
  expect(
    (await stack.owner.pool.query('SELECT 1 FROM assets WHERE id=$1', [image.id])).rowCount,
  ).toBe(1);
  expect(
    (await owner.http.write('/api/v1/me/market-imports/confirm', { ...confirm, title: '更改确认' }))
      .status,
  ).toBe(409);
  expect(
    (await owner.http.write('/api/v1/me/market-imports/' + preview.id, undefined, 'DELETE')).status,
  ).toBe(409);
});
it('JSON在线图片不会在预览时联网，逐图确认拒绝内网并阻止未托管确认', async () => {
  const owner = await verifiedCreator(stack);
  const document = imageDocument('http://127.0.0.1/never-fetch');
  const response = await upload(
    owner.http,
    Buffer.from(JSON.stringify(document)),
    'online.persona.json',
  );
  expect(response.status).toBe(200);
  const preview = MarketImportPreviewResponseSchema.parse(await response.json()).data;
  const image = preview.images[0];
  if (!image) throw new Error('缺少图片');
  expect(image.status).toBe('pending');
  expect(
    (
      await stack.owner.pool.query(
        "SELECT 1 FROM outbox_events WHERE topic=$1 AND payload->>'assetId'=$2",
        ['market.image', image.id],
      )
    ).rowCount,
  ).toBe(0);
  expect(
    (
      await owner.http.write(
        `/api/v1/me/market-imports/${preview.id}/images/${image.id}/import-url`,
        {},
      )
    ).status,
  ).toBe(400);
  expect(
    (await owner.http.write('/api/v1/me/market-imports/confirm', confirmation(preview))).status,
  ).toBe(409);
  const states = await owner.http.raw(`/api/v1/me/market-imports/${preview.id}/images`);
  expect(MarketImportImageListResponseSchema.parse(await states.json()).data[0]?.status).toBe(
    'pending',
  );
  const uploadPath = `/api/v1/me/market-imports/${preview.id}/images/${image.id}/upload`;
  expect(
    (await upload(owner.http, Buffer.alloc(fixturePng.length), 'wrong.png', uploadPath)).status,
  ).toBe(400);
  const filled = await upload(owner.http, fixturePng, '原图.png', uploadPath);
  expect(filled.status).toBe(200);
  expect(MarketImportImageListResponseSchema.parse(await filled.json()).data[0]?.status).toBe(
    'ready',
  );
  expect(
    (await owner.http.write('/api/v1/me/market-imports/confirm', confirmation(preview))).status,
  ).toBe(200);
});
it('实际格式不符的图片拒绝并清理预览，过期临时文件经真实Worker幂等回收', async () => {
  const owner = await verifiedCreator(stack);
  expect((await upload(owner.http, await zipBytes('image/jpeg'), 'wrong.persona.zip')).status).toBe(
    400,
  );
  const response = await upload(owner.http, await zipBytes(), 'expire.persona.zip');
  expect(response.status).toBe(200);
  const preview = MarketImportPreviewResponseSchema.parse(await response.json()).data;
  const image = preview.images[0];
  if (!image) throw new Error('缺少图片');
  const stored = await stack.owner.pool.query<{ storage_key: string }>(
    'SELECT storage_key FROM market_import_assets WHERE id=$1',
    [image.id],
  );
  const key = stored.rows[0]?.storage_key;
  if (!key) throw new Error('缺少隔离素材键');
  const storage = new LocalStorage(stack.env.STORAGE_ROOT);
  expect((await storage.read(key)).byteLength).toBeGreaterThan(0);
  await stack.owner.pool.query(
    "UPDATE market_imports SET expires_at=now()-interval '1 second' WHERE id=$1",
    [preview.id],
  );
  expect((await owner.http.raw(`/api/v1/me/market-imports/${preview.id}`)).status).toBe(409);
  expect(await pruneMarketImports(stack.owner)).toBe(1);
  expect(
    (await stack.owner.pool.query('SELECT 1 FROM market_import_assets WHERE id=$1', [image.id]))
      .rowCount,
  ).toBe(0);
  await stack.tick();
  await expect
    .poll(async () => {
      try {
        await storage.read(key);
        return false;
      } catch (cause) {
        if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return true;
        throw cause;
      }
    })
    .toBe(true);
  expect(await pruneMarketImports(stack.owner)).toBe(0);
  await stack.tick();
});
it('大包预览在分配缓冲区前限制并发，并在处理完成后释放入口', async () => {
  const owner = await verifiedCreator(stack);
  const locker = await stack.owner.pool.connect();
  await locker.query('BEGIN');
  await locker.query('SELECT id FROM users WHERE username=$1 FOR UPDATE', [owner.username]);
  const source = Buffer.from(JSON.stringify(marketPersona()));
  const pending = upload(owner.http, source, 'one.persona.json');
  let first: Response | undefined;
  let second: Response | undefined;
  try {
    await expect
      .poll(
        async () =>
          (
            await stack.owner.pool.query<{ total: number }>(
              "SELECT count(*)::integer AS total FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'",
            )
          ).rows[0]?.total ?? 0,
      )
      .toBeGreaterThan(0);
    second = await upload(owner.http, source, 'two.persona.json');
  } finally {
    await locker.query('ROLLBACK');
    locker.release();
    first = await pending;
  }
  expect(second?.status).toBe(503);
  expect(first.status).toBe(200);
  await first.arrayBuffer();
  if (second) await second.arrayBuffer();
  expect((await upload(owner.http, source, 'three.persona.json')).status).toBe(200);
});
it('主动取消只清理本人未使用的预览，已排队图片任务不会恢复已取消的状态', async () => {
  const owner = await verifiedCreator(stack);
  const other = await verifiedCreator(stack);
  const document = imageDocument('https://images.fixture.invalid/original.png');
  const response = await upload(
    owner.http,
    Buffer.from(JSON.stringify(document)),
    'cancel.persona.json',
  );
  expect(response.status).toBe(200);
  const preview = MarketImportPreviewResponseSchema.parse(await response.json()).data;
  const image = preview.images[0];
  if (!image) throw new Error('缺少图片');
  expect(
    (await other.http.write('/api/v1/me/market-imports/' + preview.id, undefined, 'DELETE')).status,
  ).toBe(404);
  const queued = await owner.http.write(
    `/api/v1/me/market-imports/${preview.id}/images/${image.id}/import-url`,
    {},
  );
  expect(queued.status).toBe(200);
  expect(MarketImportImageListResponseSchema.parse(await queued.json()).data[0]?.status).toBe(
    'queued',
  );
  const event = (
    await stack.owner.pool.query<{ id: string }>(
      "SELECT id FROM outbox_events WHERE topic='market.image' AND payload->>'assetId'=$1",
      [image.id],
    )
  ).rows[0];
  if (!event) throw new Error('缺少真实图片任务');
  expect(
    (await owner.http.write('/api/v1/me/market-imports/' + preview.id, undefined, 'DELETE')).status,
  ).toBe(200);
  expect((await owner.http.raw('/api/v1/me/market-imports/' + preview.id)).status).toBe(404);
  await stack.tick();
  await expect
    .poll(
      async () =>
        (
          await stack.owner.pool.query(
            "SELECT 1 FROM processed_events WHERE consumer='market-image' AND event_id=$1",
            [event.id],
          )
        ).rowCount,
    )
    .toBe(1);
  expect(
    (await stack.owner.pool.query('SELECT 1 FROM market_import_assets WHERE id=$1', [image.id]))
      .rowCount,
  ).toBe(0);
});
it('既有与暂存素材共用账号配额，非法文件不留下半份预览或草稿', async () => {
  const owner = await verifiedCreator(stack);
  const account = (
    await stack.owner.pool.query<{ id: string }>('SELECT id FROM users WHERE username=$1', [
      owner.username,
    ])
  ).rows[0];
  if (!account) throw new Error('缺少隔离账号');
  const storage = new LocalStorage(stack.env.STORAGE_ROOT);
  // 通过真实存图服务准备历史配额，保留HTTP限流以检验当前导入入口
  for (let index = 0; index < 100; index++)
    await storeImage(stack.owner, storage, account.id, 'content', fixturePng);
  expect((await upload(owner.http, await zipBytes(), 'quota.persona.zip')).status).toBe(409);
  expect(
    (await stack.owner.pool.query('SELECT 1 FROM market_imports WHERE owner_id=$1', [account.id]))
      .rowCount,
  ).toBe(0);
  const document = marketPersona();
  expect(
    (
      await upload(
        owner.http,
        Buffer.from(JSON.stringify({ ...document, role: 'admin', status: 'APPROVED' })),
        'forged.persona.json',
      )
    ).status,
  ).toBe(422);
  expect(
    (await upload(owner.http, Buffer.alloc(4 * 1024 * 1024 + 1, 32), 'large.persona.json')).status,
  ).toBe(422);
  expect(
    (await stack.owner.pool.query('SELECT 1 FROM personas WHERE owner_id=$1', [account.id]))
      .rowCount,
  ).toBe(0);
});
