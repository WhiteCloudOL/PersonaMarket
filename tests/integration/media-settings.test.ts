import { randomUUID, createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  MediaSettingsResponseSchema,
  MediaSettingsRecordsResponseSchema,
  PublicMediaSettingsResponseSchema,
  defaultMediaSettings,
  mediaSettingsEtag,
  type MediaSettings,
  AssetResponseSchema,
  AssetJobResponseSchema,
  MarketPersonaSchema,
  MarketImportPreviewResponseSchema,
  DraftResponseSchema,
  SubmissionResponseSchema,
  PublicReleaseResponseSchema,
} from '@personamarket/contracts';
import { createMarketArchive } from '@personamarket/persona-adapters';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator, completePersona } from '../fixtures/creator.js';
import type { AuthHttp } from '../fixtures/auth-http.js';
import { fixturePng } from '../fixtures/image.js';
import { quotaImagePng } from '../fixtures/large-image.js';
import { marketPersona } from '../fixtures/market-personas.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack({ isolatedStorage: true });
});
afterEach(async () => {
  await stack?.close();
});
const path = '/api/v1/admin/settings/media';
const write = (http: AuthHttp, revision: number, data: MediaSettings, key = randomUUID()) =>
  http.write(path, { data, reason: '核对文件与图片业务配置' }, 'PATCH', {
    'If-Match': mediaSettingsEtag(revision),
    'Idempotency-Key': key,
  });
async function upload(
  http: AuthHttp,
  bytes: Uint8Array,
  endpoint = '/api/v1/me/assets/upload/content',
  filename = 'image.png',
) {
  const context = await http.context(),
    body = new FormData();
  body.set('file', new Blob([Buffer.from(bytes)]), filename);
  return fetch(http.base + endpoint, {
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

it('配置白名单、CAS并发、幂等与只读修改记录真实一致', async () => {
  const admin = await stack.admin(),
    initial = await admin.http.raw(path);
  expect(initial.headers.get('etag')).toBe('"media-1"');
  expect(MediaSettingsResponseSchema.parse(await initial.json()).data).toEqual(
    defaultMediaSettings,
  );
  const data = { ...defaultMediaSettings, uploadsEnabled: false },
    key = randomUUID();
  expect((await write(admin.http, 1, data, key)).status).toBe(200);
  expect((await write(admin.http, 1, data, key)).status).toBe(200);
  const current = await stack.browser().raw('/api/v1/settings/media');
  expect(current.headers.get('cache-control')).toContain('no-store');
  expect(PublicMediaSettingsResponseSchema.parse(await current.json())).toEqual({
    data,
    meta: { revision: 2 },
  });
  const responses = await Promise.all([
    write(admin.http, 2, { ...data, maxImagesPerAccount: 1 }),
    write(admin.http, 2, { ...data, maxImagesPerAccount: 2 }),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([200, 412]);
  const records = MediaSettingsRecordsResponseSchema.parse(
    await (await admin.http.raw(path + '/records')).json(),
  );
  expect(records.meta.total).toBe(2);
  expect(records.data[1]).toMatchObject({
    before: defaultMediaSettings,
    after: data,
    fromRevision: 1,
    toRevision: 2,
  });
});

it('普通用户无配置权限，业务设置不追加管理员近期验证', async () => {
  expect((await stack.browser().raw(path)).status).toBe(401);
  const creator = await verifiedCreator(stack);
  expect((await creator.http.raw(path)).status).toBe(403);
  expect(
    (await write(creator.http, 1, { ...defaultMediaSettings, uploadsEnabled: false })).status,
  ).toBe(403);
  const admin = await stack.admin();
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET created_at=now()-interval '20 minutes',mfa_verified_at=now()-interval '20 minutes'",
  );
  expect(
    (await write(admin.http, 1, { ...defaultMediaSettings, remoteImportsEnabled: false })).status,
  ).toBe(200);
});

it('关闭本地上传阻止新文件，已保存素材仍能本人读取和使用', async () => {
  const author = await verifiedCreator(stack),
    admin = await stack.admin();
  const first = await upload(author.http, fixturePng);
  expect(first.status).toBe(200);
  const asset = AssetResponseSchema.parse(await first.json()).data;
  const old = await (await author.http.raw('/api/v1/me/assets/' + asset.id)).arrayBuffer();
  expect(
    (await write(admin.http, 1, { ...defaultMediaSettings, uploadsEnabled: false })).status,
  ).toBe(200);
  expect((await upload(author.http, fixturePng)).status).toBe(403);
  const read = await author.http.raw('/api/v1/me/assets/' + asset.id);
  expect(read.status).toBe(200);
  expect(Buffer.from(await read.arrayBuffer())).toEqual(Buffer.from(old));
  expect(
    (await stack.owner.pool.query('SELECT count(*)::int AS total FROM assets')).rows[0]?.total,
  ).toBe(1);
});

it('原始图片字节受业务限额约束，拒绝时不留下文件和素材行', async () => {
  const author = await verifiedCreator(stack),
    admin = await stack.admin();
  expect((await write(admin.http, 1, { ...defaultMediaSettings, maxImageKiB: 64 })).status).toBe(
    200,
  );
  const tooLarge = await upload(author.http, Buffer.concat([fixturePng, Buffer.alloc(70 * 1024)]));
  expect(tooLarge.status).toBe(400);
  expect(await tooLarge.json()).toMatchObject({
    error: { code: 'INVALID_INPUT', message: expect.stringContaining('大小限制') },
  });
  expect((await upload(author.http, fixturePng)).status).toBe(200);
  expect(
    (await stack.owner.pool.query('SELECT count(*)::int AS total FROM assets')).rows[0]?.total,
  ).toBe(1);
  expect(
    (await readdir(stack.env.STORAGE_ROOT)).filter((file) => file.endsWith('.webp')),
  ).toHaveLength(1);
});

it('两个实际上传争用一个名额，只能提交一个且失败文件被清理', async () => {
  const author = await verifiedCreator(stack),
    admin = await stack.admin();
  expect(
    (await write(admin.http, 1, { ...defaultMediaSettings, maxImagesPerAccount: 1 })).status,
  ).toBe(200);
  const responses = await Promise.all([
    upload(author.http, fixturePng),
    upload(author.http, fixturePng),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  expect(
    (await stack.owner.pool.query('SELECT count(*)::int AS total FROM assets')).rows[0]?.total,
  ).toBe(1);
  expect(
    (await readdir(stack.env.STORAGE_ROOT)).filter((file) => file.endsWith('.webp')),
  ).toHaveLength(1);
});

it('存储配额按真实归一化文件计量，第二张大图拒绝后原图保持', async () => {
  const author = await verifiedCreator(stack),
    admin = await stack.admin(),
    bytes = quotaImagePng();
  expect(bytes.length).toBeLessThan(5 * 1024 * 1024);
  expect(
    (await write(admin.http, 1, { ...defaultMediaSettings, maxStorageMiBPerAccount: 1 })).status,
  ).toBe(200);
  const first = await upload(author.http, bytes);
  expect(first.status).toBe(200);
  const asset = AssetResponseSchema.parse(await first.json()).data;
  expect(asset.bytes).toBeGreaterThan(512 * 1024);
  expect(asset.bytes).toBeLessThan(1024 * 1024);
  expect((await upload(author.http, bytes)).status).toBe(409);
  expect(
    (
      await stack.owner.pool.query(
        'SELECT count(*)::int AS total,sum(bytes)::int AS bytes FROM assets',
      )
    ).rows[0],
  ).toEqual({ total: 1, bytes: asset.bytes });
  expect(
    (await readdir(stack.env.STORAGE_ROOT)).filter((file) => file.endsWith('.webp')),
  ).toHaveLength(1);
});

it('来源域、并发和关闭策略同时约束API入队与真正Worker消费', async () => {
  const author = await verifiedCreator(stack),
    admin = await stack.admin();
  const policy = {
    ...defaultMediaSettings,
    sourceDomains: ['images.example.com'],
    maxConcurrentImports: 1,
  };
  expect((await write(admin.http, 1, policy)).status).toBe(200);
  expect(
    (
      await author.http.write('/api/v1/me/assets/import-url', {
        url: 'https://other.example.com/image.png',
      })
    ).status,
  ).toBe(403);
  const queued = await author.http.write('/api/v1/me/assets/import-url', {
    url: 'https://images.example.com/image.png',
  });
  expect(queued.status).toBe(200);
  const job = AssetJobResponseSchema.parse(await queued.json()).data;
  expect(
    (
      await author.http.write('/api/v1/me/assets/import-url', {
        url: 'https://images.example.com/next.png',
      })
    ).status,
  ).toBe(429);
  expect(
    (await write(admin.http, 2, { ...policy, sourceDomains: ['other.example.com'] })).status,
  ).toBe(200);
  await stack.tick();
  await expect
    .poll(
      async () =>
        AssetJobResponseSchema.parse(
          await (await author.http.raw('/api/v1/me/asset-jobs/' + job.id)).json(),
        ).data.status,
    )
    .toBe('failed');
  expect(
    (await stack.owner.pool.query('SELECT error_code FROM asset_jobs WHERE id=$1', [job.id]))
      .rows[0]?.error_code,
  ).toBe('IMAGE_IMPORT_NOT_ALLOWED');
  expect((await write(admin.http, 3, { ...policy, remoteImportsEnabled: false })).status).toBe(200);
  expect(
    (
      await author.http.write('/api/v1/me/assets/import-url', {
        url: 'https://images.example.com/new.png',
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await stack.owner.pool.query(
        "SELECT count(*)::int AS total FROM outbox_events WHERE topic='asset.import'",
      )
    ).rows[0]?.total,
  ).toBe(1);
  expect(
    (await stack.owner.pool.query('SELECT count(*)::int AS total FROM assets')).rows[0]?.total,
  ).toBe(0);
});

it('通用包内图片、本地补图和在线请求均遵循配置，旧预览可读可取消', async () => {
  const author = await verifiedCreator(stack),
    admin = await stack.admin(),
    key = randomUUID();
  const declaration = {
    key,
    mimeType: 'image/png',
    bytes: fixturePng.length,
    sha256: createHash('sha256').update(fixturePng).digest('hex'),
  };
  const source = marketPersona();
  const document = MarketPersonaSchema.parse({
    ...source,
    assets: [{ ...declaration, url: 'https://images.example.com/a.png' }],
    metadata: { ...source.metadata, readmeMarkdown: '![图](asset://' + key + ')' },
  });
  expect(
    (await write(admin.http, 1, { ...defaultMediaSettings, uploadsEnabled: false })).status,
  ).toBe(200);
  const json = await upload(
    author.http,
    Buffer.from(JSON.stringify(document)),
    '/api/v1/me/market-imports/preview',
    'test.persona.json',
  );
  expect(json.status).toBe(200);
  const preview = MarketImportPreviewResponseSchema.parse(await json.json()).data;
  const image = preview.images[0];
  if (!image) throw Error('夹具图片缺失');
  expect(
    (
      await upload(
        author.http,
        fixturePng,
        '/api/v1/me/market-imports/' + preview.id + '/images/' + image.id + '/upload',
      )
    ).status,
  ).toBe(403);
  const archive = MarketPersonaSchema.parse({
    ...document,
    assets: [{ ...declaration, path: 'assets/' + key + '.png' }],
    metadata: { ...source.metadata, readmeMarkdown: '![图](assets/' + key + '.png)' },
  });
  const parts: Uint8Array[] = [];
  for await (const part of createMarketArchive(archive, async () => fixturePng, new Date())) {
    if (!(part instanceof Uint8Array)) throw Error('错误夹具流');
    parts.push(part);
  }
  expect(
    (
      await upload(
        author.http,
        Buffer.concat(parts),
        '/api/v1/me/market-imports/preview',
        'test.persona.zip',
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await write(admin.http, 2, {
        ...defaultMediaSettings,
        uploadsEnabled: false,
        remoteImportsEnabled: false,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await author.http.write(
        '/api/v1/me/market-imports/' + preview.id + '/images/' + image.id + '/import-url',
        {},
      )
    ).status,
  ).toBe(403);
  expect((await author.http.raw('/api/v1/me/market-imports/' + preview.id)).status).toBe(200);
  expect(
    (await author.http.write('/api/v1/me/market-imports/' + preview.id, undefined, 'DELETE'))
      .status,
  ).toBe(200);
});

it('收紧README图片数量只约束新送审，旧公开快照与草稿内容保持', async () => {
  const author = await verifiedCreator(stack),
    admin = await stack.admin();
  const work = await completePersona(author.http);
  const image = await upload(author.http, fixturePng);
  expect(image.status).toBe(200);
  const asset = AssetResponseSchema.parse(await image.json()).data;
  const readme = `![第一处](asset://${asset.id})\n![第二处](asset://${asset.id})`;
  const saved = await author.http.write(
    '/api/v1/me/personas/' + work.id + '/draft',
    { ...work.draft, readmeMarkdown: readme },
    'PUT',
    { 'If-Match': '"draft-2"' },
  );
  expect(saved.status).toBe(200);
  const current = DraftResponseSchema.parse(await saved.json());
  const submit = async (version: string, revision: number) =>
    author.http.write(
      '/api/v1/me/personas/' + work.id + '/releases',
      { version, expectedDraftRevision: revision, changelog: '核对图片数量策略', confirmed: true },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
  const sent = await submit('1.0.0', current.meta.revision);
  expect(sent.status).toBe(200);
  const submission = SubmissionResponseSchema.parse(await sent.json()).data;
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/moderation/submissions/' + submission.id + '/review',
        {
          action: 'approve',
          expectedRevision: 1,
          reason: '核对旧版图片保持',
          selfReviewConfirmed: false,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await write(admin.http, 1, {
        ...defaultMediaSettings,
        maxReadmeImages: 1,
        uploadsEnabled: false,
      })
    ).status,
  ).toBe(200);
  const old = await stack
    .browser()
    .raw('/api/v1/personas/' + work.id + '/releases/' + submission.releaseId);
  expect(old.status).toBe(200);
  expect(PublicReleaseResponseSchema.parse(await old.json()).data.snapshot.readmeMarkdown).toBe(
    readme,
  );
  const kept = await author.http.write(
    '/api/v1/me/personas/' + work.id + '/draft',
    { ...current.data.draft, summary: '历史图片保留，继续编辑' },
    'PUT',
    { 'If-Match': '"draft-' + current.meta.revision + '"' },
  );
  expect(kept.status).toBe(200);
  const keptDraft = DraftResponseSchema.parse(await kept.json());
  expect(keptDraft.data.draft.readmeMarkdown).toBe(readme);
  const refused = await submit('1.1.0', keptDraft.meta.revision);
  expect(refused.status).toBe(422);
  expect(await refused.json()).toMatchObject({
    error: { code: 'VALIDATION_FAILED', message: expect.stringContaining('当前上限') },
  });
  expect(
    (await stack.owner.pool.query('SELECT count(*)::int AS total FROM persona_releases')).rows[0]
      ?.total,
  ).toBe(1);
});
