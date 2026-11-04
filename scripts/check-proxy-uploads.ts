import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { z } from 'zod';
import {
  MarketPersonaSchema,
  MarketImportPreviewResponseSchema,
  AssetResponseSchema,
  PERSONA_AVATAR_MAX_BYTES,
  DraftResponseSchema,
  ImportPreviewResponseSchema,
  TextImportSourceResponseSchema,
} from '@personamarket/contracts';
import { createMarketArchive } from '@personamarket/persona-adapters';
import { AuthHttp } from '../tests/fixtures/auth-http.js';
import { marketPersona } from '../tests/fixtures/market-personas.js';
import { fixturePng } from '../tests/fixtures/image.js';

const inputChunks: Buffer[] = [];
for await (const chunk of process.stdin) {
  if (!(chunk instanceof Buffer)) throw new Error('无效测试输入');
  inputChunks.push(chunk);
  if (inputChunks.reduce((total, value) => total + value.length, 0) > 4096)
    throw new Error('测试输入超出范围');
}
const input = z
  .strictObject({
    origin: z.url(),
    publicOrigin: z.url(),
    project: z.string().regex(/^pm-fresh-[a-f0-9]{32}$/),
    account: z.strictObject({
      username: z.string(),
      email: z.email(),
      password: z.string().min(12).max(64),
    }),
  })
  .parse(JSON.parse(Buffer.concat(inputChunks).toString('utf8')));
const target = new URL(input.origin);
assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.protocol, 'http:');
assert.ok(Number(target.port) > 1024 && !['3000', '3001', '8080'].includes(target.port));
const http = new AuthHttp(input.origin, input.publicOrigin);
assert.equal(
  (
    await http.write('/api/v1/auth/login', {
      identifier: input.account.username,
      password: input.account.password,
    })
  ).status,
  200,
);
const mib = 1024 * 1024;
async function upload(path: string, bytes: Buffer<ArrayBuffer>, filename: string) {
  const context = await http.context();
  const body = new FormData();
  body.set('file', new Blob([bytes]), filename);
  return fetch(http.base + path, {
    method: 'POST',
    body,
    headers: {
      Origin: http.origin,
      'X-CSRF-Token': context.data.csrfToken,
      'X-Expected-Account': context.data.account?.id ?? '',
      Cookie: [...http.cookies].map(([key, value]) => key + '=' + value).join('; '),
    },
    signal: AbortSignal.timeout(30000),
  });
}
const previewPath = '/api/v1/me/market-imports/preview';
const document = marketPersona();
const paddedJson = Buffer.alloc(4 * mib, 0x20);
Buffer.from(JSON.stringify(document)).copy(paddedJson);
const jsonResponse = await upload(previewPath, paddedJson, 'boundary.persona.json');
assert.equal(jsonResponse.status, 200, '合法4MiB JSON及multipart边界应穿过Caddy');
const jsonPreview = MarketImportPreviewResponseSchema.parse(await jsonResponse.json()).data;
assert.equal(
  (await http.write('/api/v1/me/market-imports/' + jsonPreview.id, undefined, 'DELETE')).status,
  200,
);

const nativePath = '/api/v1/me/persona-imports/preview/file?format=maibot-toml&encoding=auto';
const nativePrefix = Buffer.concat([
  Buffer.from('[personality]\npersonality="  '),
  Buffer.from([0xd6, 0xd0, 0xce, 0xc4]),
  Buffer.from('  "\nreply_style="plain"\nbehavior_style="kind"\n#'),
]);
const nativeBytes = Buffer.concat([
  nativePrefix,
  Buffer.alloc(4 * mib - nativePrefix.length, 0x78),
]);
const nativeResponse = await upload(nativePath, nativeBytes, '原始GBK边界.toml');
assert.equal(nativeResponse.status, 200, '恰好4MiB的原生GBK文件及multipart边界应穿过Caddy');
const nativePreview = ImportPreviewResponseSchema.parse(await nativeResponse.json()).data;
assert.deepEqual(nativePreview.persona, {
  platform: 'maibot',
  content: { personality: '  中文  ', replyStyle: 'plain', behaviorStyle: 'kind' },
});
assert.deepEqual(nativePreview.sourceEncoding, { encoding: 'gb18030', determinedBy: 'fallback' });
const nativeSaved = await http.write('/api/v1/me/persona-imports/confirm', {
  previewId: nativePreview.id,
  contentHash: nativePreview.contentHash,
  title: '代理原生编码验收',
  sourceDescription: '隔离Compose的GBK文件',
  confirmed: true,
  target: { mode: 'new' },
});
assert.equal(nativeSaved.status, 200);
assert.deepEqual(
  DraftResponseSchema.parse(await nativeSaved.json()).data.draft.content,
  nativePreview.persona.content,
);

const astrPrefix = Buffer.from(
  '\ufeff{"system_prompt":"  星光🌟\\r\\n第二行  ","begin_dialogs":[]}',
  'utf16le',
).swap16();
const astrBytes = Buffer.concat([
  astrPrefix,
  Buffer.alloc(4 * mib - astrPrefix.length, Buffer.from([0, 0x20])),
]);
const astrPath = '/api/v1/me/persona-imports/preview/file?format=astrbot-json&encoding=auto';
const astrResponse = await upload(astrPath, astrBytes, 'UTF16BE边界.json');
assert.equal(astrResponse.status, 200, 'Linux运行镜像应真实读取4MiB UTF-16 BE原生JSON');
const astrPreview = ImportPreviewResponseSchema.parse(await astrResponse.json()).data;
assert.deepEqual(astrPreview.sourceEncoding, { encoding: 'utf-16be', determinedBy: 'bom' });
assert.deepEqual(astrPreview.persona, {
  platform: 'astrbot',
  content: { systemPrompt: '  星光🌟\r\n第二行  ', dialoguePairs: [] },
});
assert.equal(
  (await upload(nativePath, Buffer.concat([nativeBytes, Buffer.from(' ')]), 'oversized.toml'))
    .status,
  413,
);
assert.equal(
  (await upload(nativePath, nativePrefix, 'retry.toml')).status,
  200,
  '原生文件超限后必须释放共享上传名额',
);

// TXT/MD 与原生文件共享明确的4MiB文件入口，Linux实际解码后仍完整保留原文
const textPath = '/api/v1/me/persona-imports/text/source/file?format=text-markdown&encoding=auto';
const textResponse = await upload(textPath, nativeBytes, 'GBK文档.md');
assert.equal(textResponse.status, 200, '恰好4MiB的TXT/Markdown及multipart边界应穿过Caddy');
assert.equal(textResponse.headers.get('cache-control'), 'private, no-store');
const textSource = TextImportSourceResponseSchema.parse(await textResponse.json()).data;
assert.equal(textSource.text, new TextDecoder('gb18030', { fatal: true }).decode(nativeBytes));
assert.deepEqual(textSource.sourceEncoding, { encoding: 'gb18030', determinedBy: 'fallback' });
assert.equal(
  (await upload(textPath, Buffer.concat([nativeBytes, Buffer.from(' ')]), 'oversized.md')).status,
  413,
);
assert.equal(
  (await upload(textPath, Buffer.from('retry after oversized'), 'retry.md')).status,
  200,
);

function paddedPng(totalBytes: number) {
  const payload = randomBytes(totalBytes - fixturePng.length - 12);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length);
  header.write('paDd', 4, 'ascii');
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(payload, crc32(header.subarray(4))));
  return Buffer.concat([
    fixturePng.subarray(0, -12),
    header,
    payload,
    checksum,
    fixturePng.subarray(-12),
  ]);
}
const png = paddedPng(4 * mib + 128 * 1024);
const imageResponse = await upload('/api/v1/me/assets/upload/content', png, 'large.png');
assert.equal(imageResponse.status, 200, '合法大于4MiB的PNG应穿过Caddy并真实解码');
const image = AssetResponseSchema.parse(await imageResponse.json()).data;
assert.equal(image.mime, 'image/webp');
assert.ok(image.bytes < png.length);
const avatarPath = '/api/v1/me/assets/upload-persona-avatar';
const avatar = await upload(avatarPath, paddedPng(PERSONA_AVATAR_MAX_BYTES - 1), 'avatar.png');
assert.equal(avatar.status, 200, '小于 10 MiB 的头像应经代理成功转为 WebP');
const avatarAsset = AssetResponseSchema.parse(await avatar.json()).data;
assert.equal(avatarAsset.mime, 'image/webp');
assert.ok(avatarAsset.bytes < 512 * 1024);
assert.ok(avatarAsset.width <= 512 && avatarAsset.height <= 512);
assert.equal(
  (await upload(avatarPath, paddedPng(PERSONA_AVATAR_MAX_BYTES), 'too-large.png')).status,
  413,
);
assert.equal((await http.raw('/api/v1/me/assets/' + image.id)).status, 200);
assert.equal(
  (await new AuthHttp(input.origin, input.publicOrigin).raw('/api/v1/public/assets/' + image.id))
    .status,
  404,
);

const key = randomUUID();
const portable = MarketPersonaSchema.parse({
  ...document,
  metadata: {
    ...document.metadata,
    avatarKey: key,
    readmeMarkdown: `# 原文\n\n![图](assets/${key}.png)`,
  },
  assets: [
    {
      key,
      path: `assets/${key}.png`,
      mimeType: 'image/png',
      bytes: png.length,
      sha256: createHash('sha256').update(png).digest('hex'),
    },
  ],
});
const archiveChunks: Uint8Array[] = [];
for await (const chunk of createMarketArchive(portable, async () => png, new Date())) {
  if (!(chunk instanceof Uint8Array)) throw new Error('无效归档输出');
  archiveChunks.push(chunk);
}
const archive = Buffer.concat(archiveChunks);
assert.ok(archive.length > 4 * mib);
const zipResponse = await upload(previewPath, archive, 'large.persona.zip');
assert.equal(zipResponse.status, 200, '合法大ZIP应经Caddy进入真实私有导入流程');
const preview = MarketImportPreviewResponseSchema.parse(await zipResponse.json()).data;
assert.equal(preview.images[0]?.status, 'ready');
const saved = await http.write('/api/v1/me/market-imports/confirm', {
  previewId: preview.id,
  contentHash: preview.contentHash,
  title: '代理上传验收角色',
  sourceDescription: '隔离Compose测试文件',
  authorizationStatement: '测试作者授权并保留署名与来源',
  confirmed: true,
  target: { mode: 'new' },
});
assert.equal(saved.status, 200);
assert.equal(
  DraftResponseSchema.parse(await saved.json()).data.draft.avatarAssetId,
  preview.images[0]?.id,
);

assert.equal(
  (await upload('/api/v1/me/assets/upload/content', paddedPng(5 * mib + 1), 'oversized.png'))
    .status,
  413,
);
const oversizedArchive = Buffer.alloc(128 * mib + 1);
oversizedArchive.writeUInt32LE(0x04034b50);
assert.equal((await upload(previewPath, oversizedArchive, 'oversized.zip')).status, 413);
const retried = await upload(
  previewPath,
  Buffer.from(JSON.stringify(document)),
  'retry.persona.json',
);
assert.equal(retried.status, 200, '超限拒绝后必须释放上传名额');
const retryPreview = MarketImportPreviewResponseSchema.parse(await retried.json()).data;
assert.equal(
  (await http.write('/api/v1/me/market-imports/' + retryPreview.id, undefined, 'DELETE')).status,
  200,
);
const ordinary = await http.raw('/api/v1/auth/login', {
  method: 'POST',
  body: JSON.stringify({ padding: 'x'.repeat(4 * mib + 1) }),
});
assert.equal(ordinary.status, 413);
console.log(
  '真实Caddy→API：4MiB通用JSON/原生GBK/UTF16边界、原文确认、PNG和人设头像重编码、大ZIP预览确认、超限和拒绝后重试通过',
);
