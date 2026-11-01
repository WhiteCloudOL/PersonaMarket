import { createHash, randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  AssetJobResponseSchema,
  AssetResponseSchema,
  DraftResponseSchema,
  ErrorResponseSchema,
  ImportPreviewResponseSchema,
  MarketImportPreviewResponseSchema,
  MarketImportImageListResponseSchema,
  MarketPersonaSchema,
  SystemSettingsResponseSchema,
  TextImportSourceResponseSchema,
  systemSettingsEtag,
  type MarketImportPreview,
  type MarketPersona,
} from '@personamarket/contracts';
import { createMarketArchive, serializeMaiBot } from '@personamarket/persona-adapters';
import { LocalStorage, stageMarketImage, storeImage, type Storage } from '@personamarket/server';
import type { z } from 'zod';
import { createAuthStack } from '../fixtures/auth-stack.js';
import type { AuthHttp } from '../fixtures/auth-http.js';
import { completePersona, verifiedCreator } from '../fixtures/creator.js';
import { fixturePng } from '../fixtures/image.js';
import { marketPersona } from '../fixtures/market-personas.js';

// 一例一套受控隔离API/PG/Redis/Mailpit/Storage；不停止依赖或注入网络/锁故障。
let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack({ isolatedStorage: true });
});
afterEach(async () => {
  await stack?.close();
});
const systemPath = '/api/v1/admin/settings/system';
const nativePath = '/api/v1/me/persona-imports';
const marketPath = '/api/v1/me/market-imports';
const remoteUrl = 'https://example.com/fixture.png';

async function maintenance(http: AuthHttp, maintenanceEnabled: boolean) {
  const current = SystemSettingsResponseSchema.parse(await (await http.raw(systemPath)).json());
  const account = (await http.context()).data.account;
  if (!account) throw new Error('缺少维护操作管理员');
  const response = await http.write(
    systemPath,
    {
      data: { maintenanceEnabled, maintenanceMessage: '正在维护，请稍后明确重试' },
      reason: maintenanceEnabled ? '核对普通创作事务门禁' : '恢复受控创作流程',
      confirmed: true,
    },
    'PATCH',
    {
      'If-Match': systemSettingsEtag(current.meta.revision),
      'Idempotency-Key': randomUUID(),
      'X-Expected-Account': account.id,
    },
  );
  expect(response.status).toBe(200);
  return SystemSettingsResponseSchema.parse(await response.json());
}
async function blocked(response: Response) {
  expect(response.status).toBe(503);
  expect(response.headers.get('retry-after')).toBe('60');
  expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe('MAINTENANCE_MODE');
}
async function upload(http: AuthHttp, path: string, bytes: Uint8Array, filename = 'image.png') {
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
async function snapshot() {
  const result = await stack.owner.pool.query<{ data: unknown }>(`SELECT jsonb_build_object(
    'personas',(SELECT count(*) FROM personas),
    'drafts',(SELECT jsonb_agg(jsonb_build_array(persona_id,revision) ORDER BY persona_id) FROM persona_drafts),
    'assets',(SELECT count(*) FROM assets),
    'references',(SELECT count(*) FROM asset_references),
    'native',(SELECT jsonb_agg(jsonb_build_array(id,result_persona_id,confirmation_hash,expires_at,consumed_at) ORDER BY id) FROM persona_imports),
    'market',(SELECT jsonb_agg(jsonb_build_array(id,state,result_persona_id,confirmation_hash,expires_at,consumed_at) ORDER BY id) FROM market_imports),
    'images',(SELECT jsonb_agg(jsonb_build_array(id,status,bytes,sha256) ORDER BY id) FROM market_import_assets),
    'jobs',(SELECT jsonb_agg(jsonb_build_array(id,status,asset_id) ORDER BY id) FROM asset_jobs),
    'outbox',(SELECT count(*) FROM outbox_events WHERE topic IN ('asset.import','market.image','storage.cleanup'))
  ) AS data`);
  return result.rows[0]?.data;
}
const nativeInput = {
  format: 'maibot-toml' as const,
  filename: '维护核对.toml',
  source: serializeMaiBot({
    platform: 'maibot',
    content: { personality: '保留原文', replyStyle: '自然表达', behaviorStyle: '尊重边界' },
  }),
};
type NativePreview = z.infer<typeof ImportPreviewResponseSchema>['data'];
function nativeConfirmation(preview: NativePreview) {
  return {
    previewId: preview.id,
    contentHash: preview.contentHash,
    title: '维护核对导入作品',
    sourceDescription: '来自本人受控的正常原生文件',
    target: { mode: 'new' as const },
    confirmed: true,
  };
}
function marketConfirmation(preview: MarketImportPreview) {
  return {
    previewId: preview.id,
    contentHash: preview.contentHash,
    title: '维护核对通用作品',
    sourceDescription: '来自作者正常分享文件，已核实来源',
    authorizationStatement: '作者允许署名转载',
    target: { mode: 'new' as const },
    confirmed: true,
  };
}
async function nativePreview(http: AuthHttp) {
  const response = await http.write(nativePath + '/preview', nativeInput);
  expect(response.status).toBe(200);
  return ImportPreviewResponseSchema.parse(await response.json()).data;
}
async function marketPreview(http: AuthHttp, document = marketPersona()) {
  const response = await upload(
    http,
    marketPath + '/preview',
    Buffer.from(JSON.stringify(document)),
    '正常.persona.json',
  );
  expect(response.status).toBe(200);
  return MarketImportPreviewResponseSchema.parse(await response.json()).data;
}
function imageDocument(remote = false) {
  const document = marketPersona(),
    key = randomUUID();
  return MarketPersonaSchema.parse({
    ...document,
    metadata: { ...document.metadata, avatarKey: key },
    assets: [
      {
        key,
        ...(remote ? { url: remoteUrl } : { path: `assets/${key}.png` }),
        mimeType: 'image/png',
        bytes: fixturePng.length,
        sha256: createHash('sha256').update(fixturePng).digest('hex'),
      },
    ],
  });
}
async function archive(document: MarketPersona) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of createMarketArchive(document, async () => fixturePng, new Date())) {
    if (!(chunk instanceof Uint8Array)) throw new Error('受控ZIP流类型错误');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

it('维护拒绝普通及管理员创作者新建/保存/三类上传/新远程任务，既有引用和私有读取保留，恢复后明确重试', async () => {
  const author = await verifiedCreator(stack),
    admin = await stack.admin();
  const assetResponse = await upload(author.http, '/api/v1/me/assets/upload/content', fixturePng);
  expect(assetResponse.status).toBe(200);
  const asset = AssetResponseSchema.parse(await assetResponse.json()).data;
  const persona = await completePersona(author.http);
  const draft = { ...persona.draft, avatarAssetId: asset.id };
  expect(
    (
      await author.http.write('/api/v1/me/personas/' + persona.id + '/draft', draft, 'PUT', {
        'If-Match': '"draft-2"',
      })
    ).status,
  ).toBe(200);
  const oldBytes = Buffer.from(
    await (await author.http.raw('/api/v1/me/assets/' + asset.id)).arrayBuffer(),
  );
  await maintenance(admin.http, true);
  const before = await snapshot();
  for (const http of [author.http, admin.http]) {
    await blocked(
      await http.write('/api/v1/me/personas', { platform: 'maibot', title: '维护时不能新建' }),
    );
  }
  await blocked(
    await author.http.write(
      '/api/v1/me/personas/' + persona.id + '/draft',
      {
        ...draft,
        summary: '候选输入继续保留',
      },
      'PUT',
      { 'If-Match': '"draft-3"' },
    ),
  );
  for (const purpose of ['content', 'avatar', 'evidence']) {
    await blocked(await upload(author.http, '/api/v1/me/assets/upload/' + purpose, fixturePng));
  }
  await blocked(await author.http.write('/api/v1/me/assets/import-url', { url: remoteUrl }));
  expect(await snapshot()).toEqual(before);
  expect(
    DraftResponseSchema.parse(
      await (await author.http.raw('/api/v1/me/personas/' + persona.id + '/draft')).json(),
    ).meta.revision,
  ).toBe(3);
  expect(
    Buffer.from(await (await author.http.raw('/api/v1/me/assets/' + asset.id)).arrayBuffer()),
  ).toEqual(oldBytes);
  expect((await author.http.raw('/api/v1/me/assets')).status).toBe(200);
  await maintenance(admin.http, false);
  expect(
    (
      await author.http.write(
        '/api/v1/me/personas/' + persona.id + '/draft',
        {
          ...draft,
          summary: '候选输入继续保留',
        },
        'PUT',
        { 'If-Match': '"draft-3"' },
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await author.http.write('/api/v1/me/personas', {
        platform: 'maibot',
        title: '恢复后明确新建',
      })
    ).status,
  ).toBe(200);
  const [overlapping] = await Promise.all([
    author.http.write(
      '/api/v1/me/personas/' + persona.id + '/draft',
      {
        ...draft,
        summary: '正常保存与维护切换重叠',
      },
      'PUT',
      { 'If-Match': '"draft-4"' },
    ),
    maintenance(admin.http, true),
  ]);
  expect([200, 503]).toContain(overlapping.status);
  if (overlapping.status === 503) await blocked(overlapping);
  const committed = DraftResponseSchema.parse(
    await (await author.http.raw('/api/v1/me/personas/' + persona.id + '/draft')).json(),
  );
  expect(committed.meta.revision).toBe(overlapping.status === 200 ? 5 : 4);
  await blocked(
    await author.http.write('/api/v1/me/personas/' + persona.id + '/draft', draft, 'PUT', {
      'If-Match': '"draft-' + committed.meta.revision + '"',
    }),
  );
  expect(
    DraftResponseSchema.parse(
      await (await author.http.raw('/api/v1/me/personas/' + persona.id + '/draft')).json(),
    ),
  ).toEqual(committed);
});

it('原生和通用导入的新建/替换确认均受最终门禁，成功原请求维护期间只读核对且不续期或重复创建', async () => {
  const author = await verifiedCreator(stack),
    admin = await stack.admin();
  const nativeTarget = await completePersona(author.http),
    marketTarget = await completePersona(author.http);
  const nativeNew = nativeConfirmation(await nativePreview(author.http));
  const nativeReplace = {
    ...nativeConfirmation(await nativePreview(author.http)),
    target: {
      mode: 'replace',
      personaId: nativeTarget.id,
      expectedRevision: 2,
    },
  };
  const marketNew = marketConfirmation(await marketPreview(author.http));
  const marketReplace = {
    ...marketConfirmation(await marketPreview(author.http)),
    target: {
      mode: 'replace',
      personaId: marketTarget.id,
      expectedRevision: 2,
    },
  };
  const commands = [
    { path: nativePath + '/confirm', input: nativeNew },
    { path: nativePath + '/confirm', input: nativeReplace },
    { path: marketPath + '/confirm', input: marketNew },
    { path: marketPath + '/confirm', input: marketReplace },
  ];
  await maintenance(admin.http, true);
  const before = await snapshot();
  for (const command of commands)
    await blocked(await author.http.write(command.path, command.input));
  expect(await snapshot()).toEqual(before);
  await maintenance(admin.http, false);
  const saved: string[] = [];
  for (const command of commands) {
    const response = await author.http.write(command.path, command.input);
    expect(response.status).toBe(200);
    saved.push(DraftResponseSchema.parse(await response.json()).data.id);
  }
  await maintenance(admin.http, true);
  const completed = await snapshot();
  for (const [index, command] of commands.entries()) {
    const response = await author.http.write(command.path, command.input);
    expect(response.status).toBe(200);
    expect(DraftResponseSchema.parse(await response.json()).data.id).toBe(saved[index]);
    expect(
      (await author.http.write(command.path, { ...command.input, title: '需要重新确认的不同输入' }))
        .status,
    ).toBe(409);
  }
  expect(await snapshot()).toEqual(completed);
});

it('维护下原生JSON/文件、TXT源纯解析/映射预览和通用JSON/ZIP均拒绝，预览表及文件不增加', async () => {
  const author = await verifiedCreator(stack),
    admin = await stack.admin();
  const zip = await archive(marketPersona());
  await maintenance(admin.http, true);
  const before = await snapshot();
  await blocked(await author.http.write(nativePath + '/preview', nativeInput));
  await blocked(
    await upload(
      author.http,
      nativePath + '/preview/file?format=maibot-toml',
      Buffer.from(nativeInput.source),
      '正常.toml',
    ),
  );
  for (const format of ['text-plain', 'text-markdown']) {
    await blocked(
      await upload(
        author.http,
        nativePath + '/text/source/file?format=' + format,
        Buffer.from('本人普通映射原文'),
        '原文.txt',
      ),
    );
    await blocked(
      await author.http.write(nativePath + '/text/preview', {
        format,
        filename: '原文.txt',
        mapped: true,
        persona: {
          platform: 'maibot',
          content: { personality: '正常人格', replyStyle: '自然表达', behaviorStyle: '尊重边界' },
        },
      }),
    );
  }
  await blocked(
    await upload(
      author.http,
      marketPath + '/preview',
      Buffer.from(JSON.stringify(marketPersona())),
      '正常.persona.json',
    ),
  );
  await blocked(await upload(author.http, marketPath + '/preview', zip, '正常.persona.zip'));
  expect(await snapshot()).toEqual(before);
  expect(
    await readdir(stack.env.STORAGE_ROOT).catch((cause: unknown) => {
      if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return [];
      throw cause;
    }),
  ).toEqual([]);
  await maintenance(admin.http, false);
  const source = await upload(
    author.http,
    nativePath + '/text/source/file?format=text-plain',
    Buffer.from('恢复后本人原文'),
    '原文.txt',
  );
  expect(source.status).toBe(200);
  expect(TextImportSourceResponseSchema.parse(await source.json()).data.text).toBe(
    '恢复后本人原文',
  );
});

it('通用图片上传/新URL入队/丢弃受门禁，既有暂存图可读，已排图片核对不续期或再次排Outbox', async () => {
  const author = await verifiedCreator(stack),
    admin = await stack.admin();
  const pending = await marketPreview(author.http, imageDocument(true));
  const queued = await marketPreview(author.http, imageDocument(true));
  const pendingImage = pending.images[0],
    queuedImage = queued.images[0];
  if (!pendingImage || !queuedImage) throw new Error('缺少受控导入图片');
  const queuedPath = marketPath + '/' + queued.id + '/images/' + queuedImage.id + '/import-url';
  expect((await author.http.write(queuedPath)).status).toBe(200);
  const zipResponse = await upload(
    author.http,
    marketPath + '/preview',
    await archive(imageDocument()),
    '有图.persona.zip',
  );
  expect(zipResponse.status).toBe(200);
  const ready = MarketImportPreviewResponseSchema.parse(await zipResponse.json()).data;
  const readyImage = ready.images[0];
  if (!readyImage) throw new Error('缺少已托管图片');
  const imagePath = marketPath + '/' + ready.id + '/images/' + readyImage.id;
  const original = Buffer.from(await (await author.http.raw(imagePath)).arrayBuffer());
  await maintenance(admin.http, true);
  const before = await snapshot();
  await blocked(
    await upload(
      author.http,
      marketPath + '/' + pending.id + '/images/' + pendingImage.id + '/upload',
      fixturePng,
    ),
  );
  await blocked(
    await author.http.write(
      marketPath + '/' + pending.id + '/images/' + pendingImage.id + '/import-url',
    ),
  );
  await blocked(await author.http.write(marketPath + '/' + pending.id, undefined, 'DELETE'));
  await blocked(await author.http.write(marketPath + '/confirm', marketConfirmation(ready)));
  expect((await author.http.write(queuedPath)).status).toBe(200);
  expect((await author.http.raw(marketPath + '/' + pending.id)).status).toBe(200);
  expect(Buffer.from(await (await author.http.raw(imagePath)).arrayBuffer())).toEqual(original);
  expect(await snapshot()).toEqual(before);
  await maintenance(admin.http, false);
  expect(
    (
      await upload(
        author.http,
        marketPath + '/' + pending.id + '/images/' + pendingImage.id + '/upload',
        fixturePng,
      )
    ).status,
  ).toBe(200);
  expect((await author.http.write(marketPath + '/confirm', marketConfirmation(ready))).status).toBe(
    200,
  );
  expect((await author.http.write(marketPath + '/' + pending.id, undefined, 'DELETE')).status).toBe(
    200,
  );
});

it('正常本地put后开启维护仍由最终资产事务拒绝，只回收该次随机键，不碰既有引用文件', async () => {
  const author = await verifiedCreator(stack),
    admin = await stack.admin();
  const account = (await author.http.context()).data.account;
  if (!account) throw new Error('缺少受控上传账号');
  const storage = new LocalStorage(stack.env.STORAGE_ROOT);
  const old = await storeImage(stack.owner, storage, account.id, 'content', fixturePng);
  const persona = await completePersona(author.http);
  expect(
    (
      await author.http.write(
        '/api/v1/me/personas/' + persona.id + '/draft',
        {
          ...persona.draft,
          avatarAssetId: old.id,
        },
        'PUT',
        { 'If-Match': '"draft-2"' },
      )
    ).status,
  ).toBe(200);
  const previous = Buffer.from(await storage.read(old.storageKey));
  const before = await snapshot(),
    written: string[] = [],
    removed: string[] = [];
  // 正常存储阶段间的业务切换：真实put完成后，经真实管理API开启维护；不使存储/网络失败。
  const controlled: Storage = {
    put: async (key, bytes) => {
      await storage.put(key, bytes);
      written.push(key);
      await maintenance(admin.http, true);
    },
    read: (key) => storage.read(key),
    delete: async (key) => {
      removed.push(key);
      await storage.delete(key);
    },
  };
  await expect(
    storeImage(stack.owner, controlled, account.id, 'content', fixturePng),
  ).rejects.toMatchObject({ code: 'MAINTENANCE_MODE' });
  expect(written).toHaveLength(1);
  expect(removed).toEqual(written);
  expect(written).not.toContain(old.storageKey);
  expect(await readdir(stack.env.STORAGE_ROOT)).toEqual([old.storageKey]);
  expect(Buffer.from(await storage.read(old.storageKey))).toEqual(previous);
  expect(await snapshot()).toEqual(before);
});

it('两共享图片函数仅服务端background可继续，原已排Worker正常核对现有产物并记录业务回执', async () => {
  const author = await verifiedCreator(stack),
    admin = await stack.admin();
  const account = (await author.http.context()).data.account;
  if (!account) throw new Error('缺少受控后台素材账号');
  const storage = new LocalStorage(stack.env.STORAGE_ROOT);
  const jobResponse = await author.http.write('/api/v1/me/assets/import-url', { url: remoteUrl });
  expect(jobResponse.status).toBe(200);
  const job = AssetJobResponseSchema.parse(await jobResponse.json()).data;
  const preview = await marketPreview(author.http, imageDocument(true)),
    image = preview.images[0];
  if (!image) throw new Error('缺少受控后台导入图片');
  expect(
    (await author.http.write(marketPath + '/' + preview.id + '/images/' + image.id + '/import-url'))
      .status,
  ).toBe(200);
  const events = await stack.owner.pool.query<{
    id: string;
    topic: string;
    payload: Record<string, unknown>;
  }>(
    "SELECT id,topic,payload FROM outbox_events WHERE topic IN ('asset.import','market.image') ORDER BY topic",
  );
  expect(events.rows.map((row) => row.topic)).toEqual(['asset.import', 'market.image']);
  for (const event of events.rows) {
    expect(Object.keys(event.payload).sort()).toEqual(
      event.topic === 'asset.import' ? ['jobId', 'schemaVersion'] : ['assetId', 'schemaVersion'],
    );
  }
  // 合法的至少一次恢复边界：文件/资产已提交但任务尚未记ready，不依赖外部公网下载。
  await storeImage(stack.owner, storage, account.id, 'content', fixturePng, remoteUrl, job.id);
  await maintenance(admin.http, true);
  await expect(
    storeImage(stack.owner, storage, account.id, 'avatar', fixturePng),
  ).rejects.toMatchObject({ code: 'MAINTENANCE_MODE' });
  const background = await storeImage(
    stack.owner,
    storage,
    account.id,
    'avatar',
    fixturePng,
    undefined,
    undefined,
    [],
    'background',
  );
  expect(background.ownerId).toBe(account.id);
  await stageMarketImage(
    stack.owner,
    storage,
    preview.id,
    image.key,
    fixturePng,
    { kind: 'remote', urls: [remoteUrl] },
    'background',
  );
  const staged = await snapshot();
  await stageMarketImage(stack.owner, storage, preview.id, image.key, fixturePng);
  expect(await snapshot()).toEqual(staged);
  await expect
    .poll(async () => {
      await stack.tick();
      const receipts = await stack.owner.pool.query<{ total: number }>(
        "SELECT count(*)::int AS total FROM processed_events WHERE event_id=ANY($1::uuid[]) AND consumer IN ('asset-import','market-image')",
        [events.rows.map((row) => row.id)],
      );
      return receipts.rows[0]?.total;
    })
    .toBe(2);
  const completed = AssetJobResponseSchema.parse(
    await (await author.http.raw('/api/v1/me/asset-jobs/' + job.id)).json(),
  ).data;
  expect(completed).toMatchObject({ status: 'ready', assetId: job.id });
  const images = MarketImportImageListResponseSchema.parse(
    await (await author.http.raw(marketPath + '/' + preview.id + '/images')).json(),
  ).data;
  expect(images).toContainEqual(expect.objectContaining({ id: image.id, status: 'ready' }));
  expect(
    (await stack.owner.pool.query('SELECT count(*)::int AS total FROM assets')).rows[0]?.total,
  ).toBe(2);
  expect(
    (
      await stack.owner.pool.query(
        'SELECT count(*)::int AS total FROM outbox_events WHERE topic=ANY($1::text[])',
        [['asset.import', 'market.image']],
      )
    ).rows[0]?.total,
  ).toBe(2);
});
