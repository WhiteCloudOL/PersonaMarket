import { request as httpRequest, type IncomingMessage } from 'node:http';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  DraftResponseSchema,
  ImportPreviewResponseSchema,
  MarketImportPreviewResponseSchema,
} from '@personamarket/contracts';
import { serializeAstrBot, serializeMaiBot } from '@personamarket/persona-adapters';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator } from '../fixtures/creator.js';
import type { AuthHttp } from '../fixtures/auth-http.js';
import { marketPersona } from '../fixtures/market-personas.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
const maximum = 4 * 1024 * 1024;
const endpoint = '/api/v1/me/persona-imports/preview/file';
beforeAll(async () => {
  stack = await createAuthStack();
});
afterAll(async () => {
  await stack?.close();
});

const content = {
  personality: '  人格原文\n第二行  ',
  replyStyle: '带引号 " 与反斜杠 \\',
  behaviorStyle: '尊重边界',
};
const source =
  serializeMaiBot({ platform: 'maibot', content }) +
  '\n[account]\npassword="private-native-marker-never-store"\n';
function paddedToml(size: number) {
  const prefix = Buffer.from(source + '\n#');
  return Buffer.concat([prefix, Buffer.alloc(size - prefix.byteLength, 0x78)]);
}
async function headers(http: AuthHttp) {
  const context = await http.context();
  return {
    Origin: http.origin,
    'X-CSRF-Token': context.data.csrfToken,
    Cookie: [...http.cookies].map(([name, value]) => name + '=' + value).join('; '),
  };
}
async function upload(
  http: AuthHttp,
  bytes: Uint8Array,
  filename = '边界.toml',
  format = 'maibot-toml',
  encoding = 'auto',
  path = endpoint + '?format=' + format,
) {
  const body = new FormData();
  body.set('file', new Blob([Buffer.from(bytes)]), filename);
  return fetch(http.base + path + '&encoding=' + encoding, {
    method: 'POST',
    body,
    headers: await headers(http),
    signal: AbortSignal.timeout(10000),
  });
}

it('原生文件实际接收超过2MiB至4MiB边界，只保存白名单正文并沿用私有确认与来源', async () => {
  const owner = await verifiedCreator(stack);
  const other = await verifiedCreator(stack);
  let last: ReturnType<typeof ImportPreviewResponseSchema.parse>['data'] | undefined;
  for (const size of [2 * 1024 * 1024 + 1, maximum]) {
    const response = await upload(owner.http, paddedToml(size));
    expect(response.status).toBe(200);
    last = ImportPreviewResponseSchema.parse(await response.json()).data;
    expect(last.filename).toBe('边界.toml');
    expect(last.persona).toEqual({ platform: 'maibot', content });
    expect(last.ignoredFields).toContain('account');
    const saved = await stack.owner.pool.query<{ payload: unknown }>(
      'SELECT payload FROM persona_imports WHERE id=$1',
      [last.id],
    );
    expect(JSON.stringify(saved.rows)).not.toContain('private-native-marker-never-store');
    expect(JSON.stringify(saved.rows).length).toBeLessThan(10000);
  }
  if (!last) throw new Error('缺少真实4MiB预览');
  const confirm = {
    previewId: last.id,
    contentHash: last.contentHash,
    title: '原生文件边界导入',
    sourceDescription: '作者提供的原生文件，待补充转载许可',
    target: { mode: 'new' },
    confirmed: true,
  };
  expect((await other.http.write('/api/v1/me/persona-imports/confirm', confirm)).status).toBe(404);
  const saved = await owner.http.write('/api/v1/me/persona-imports/confirm', confirm);
  expect(saved.status).toBe(200);
  const imported = DraftResponseSchema.parse(await saved.json());
  expect(imported.data.draft.content).toEqual(content);
  expect(imported.data.draft.origin).toMatchObject({
    type: 'repost',
    sourceDescription: confirm.sourceDescription,
  });
  expect(imported.data.draft.rightsAccepted).toBe(false);
  expect((await other.http.raw('/api/v1/me/personas/' + imported.data.id + '/draft')).status).toBe(
    404,
  );
  expect(
    (
      await owner.http.write('/api/v1/me/persona-imports/preview', {
        format: 'maibot-toml',
        filename: 'legacy.toml',
        source: paddedToml(2 * 1024 * 1024 + 1).toString('utf8'),
      })
    ).status,
  ).toBe(400);
  const astr = Buffer.from(
    serializeAstrBot(
      { platform: 'astrbot', content: { systemPrompt: '  星光原文  ', dialoguePairs: [] } },
      '边界人格',
    ),
  );
  const response = await upload(
    owner.http,
    Buffer.concat([astr, Buffer.alloc(maximum - astr.byteLength, 0x20)]),
    '边界.json',
    'astrbot-json',
  );
  expect(response.status).toBe(200);
  expect(ImportPreviewResponseSchema.parse(await response.json()).data.persona).toEqual({
    platform: 'astrbot',
    content: { systemPrompt: '  星光原文  ', dialoguePairs: [] },
  });
});

it('真实multipart按编码读取GBK和UTF16，预览结果与私有确认保持原文', async () => {
  const owner = await verifiedCreator(stack);
  const gbk = Buffer.concat([
    Buffer.from('{"system_prompt":"  '),
    Buffer.from([0xd6, 0xd0, 0xce, 0xc4]),
    Buffer.from('\\r\\nend  ","begin_dialogs":["q","a"]}'),
  ]);
  for (const encoding of ['auto', 'gbk']) {
    const response = await upload(owner.http, gbk, '中文.json', 'astrbot-json', encoding);
    expect(response.status).toBe(200);
    const preview = ImportPreviewResponseSchema.parse(await response.json()).data;
    expect(preview.persona).toMatchObject({
      platform: 'astrbot',
      content: { systemPrompt: '  中文\r\nend  ' },
    });
    expect(preview.sourceEncoding).toEqual({
      encoding: encoding === 'auto' ? 'gb18030' : 'gbk',
      determinedBy: encoding === 'auto' ? 'fallback' : 'manual',
    });
    const saved = await owner.http.write('/api/v1/me/persona-imports/confirm', {
      previewId: preview.id,
      contentHash: preview.contentHash,
      title: '编码确认导入',
      sourceDescription: '受控测试作者提供，保留原始换行',
      target: { mode: 'new' },
      confirmed: true,
    });
    expect(saved.status).toBe(200);
    expect(DraftResponseSchema.parse(await saved.json()).data.draft.content).toEqual(
      preview.persona.content,
    );
  }
  const utf16 = Buffer.from('\ufeff' + serializeMaiBot({ platform: 'maibot', content }), 'utf16le');
  for (const encoding of ['utf-16le', 'utf-16be'] as const) {
    const bytes = Buffer.from(utf16);
    if (encoding === 'utf-16be') bytes.swap16();
    const response = await upload(owner.http, bytes);
    expect(response.status).toBe(200);
    const preview = ImportPreviewResponseSchema.parse(await response.json()).data;
    expect(preview.persona).toEqual({ platform: 'maibot', content });
    expect(preview.sourceEncoding).toEqual({ encoding, determinedBy: 'bom' });
  }
});

it('通用JSON读取常见编码，重读预览保留实际编码', async () => {
  const owner = await verifiedCreator(stack);
  const document = marketPersona('astrbot');
  if (document.platform !== 'astrbot') throw new Error('错误的受控平台');
  document.content.systemPrompt = 'GBK_PROMPT';
  const ascii = JSON.stringify(document).replace(
    /[^\x20-\x7e]/g,
    (char) => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'),
  );
  const [before, after] = ascii.split('GBK_PROMPT');
  if (before === undefined || after === undefined) throw new Error('缺少受控正文');
  const gbk = Buffer.concat([
    Buffer.from(before),
    Buffer.from([0xd6, 0xd0, 0xce, 0xc4]),
    Buffer.from(after),
  ]);
  for (const bytes of [gbk, Buffer.from('\ufeff' + ascii, 'utf16le')]) {
    const response = await upload(
      owner.http,
      bytes,
      '常见编码.persona.json',
      '',
      'auto',
      '/api/v1/me/market-imports/preview?',
    );
    expect(response.status).toBe(200);
    const preview = MarketImportPreviewResponseSchema.parse(await response.json()).data;
    expect(preview.draft.content).toMatchObject({
      systemPrompt: bytes === gbk ? '中文' : 'GBK_PROMPT',
    });
    expect(preview.sourceEncoding?.encoding).toBe(bytes === gbk ? 'gb18030' : 'utf-16le');
    const read = await owner.http.raw('/api/v1/me/market-imports/' + preview.id);
    expect(read.status).toBe(200);
    expect(MarketImportPreviewResponseSchema.parse(await read.json()).data.sourceEncoding).toEqual(
      preview.sourceEncoding,
    );
  }
});

it('身份与CSRF先于文件解析，非法格式/UTF8/多文件/超限被拒绝且能够重新预览', async () => {
  const owner = await verifiedCreator(stack);
  expect((await upload(stack.browser(), Buffer.from(source))).status).toBe(401);
  const unsigned = new FormData();
  unsigned.set('file', new Blob([Buffer.from(source)]), 'unsigned.toml');
  const auth = await headers(owner.http);
  expect(
    (
      await fetch(owner.http.base + endpoint + '?format=maibot-toml', {
        method: 'POST',
        body: unsigned,
        headers: { Cookie: auth.Cookie, Origin: auth.Origin },
        signal: AbortSignal.timeout(10000),
      })
    ).status,
  ).toBe(403);
  expect((await upload(owner.http, Buffer.from(source), 'bad.toml', 'markdown')).status).toBe(400);
  expect(
    (await upload(owner.http, Buffer.from([0xc3, 0x28]), 'bad.toml', 'maibot-toml', 'utf-8'))
      .status,
  ).toBe(422);
  expect(
    (await upload(owner.http, Buffer.from(source), 'bad.toml', 'maibot-toml', 'not-an-encoding'))
      .status,
  ).toBe(400);
  expect((await upload(owner.http, Buffer.from(source), 'x'.repeat(161) + '.toml')).status).toBe(
    400,
  );
  expect((await upload(owner.http, paddedToml(maximum + 1))).status).toBe(413);
  expect((await upload(owner.http, Buffer.from(source))).status).toBe(200);
  const multiple = new FormData();
  multiple.append('file', new Blob([Buffer.from(source)]), 'one.toml');
  multiple.append('file', new Blob([Buffer.from(source)]), 'two.toml');
  expect(
    (
      await fetch(owner.http.base + endpoint + '?format=maibot-toml', {
        method: 'POST',
        body: multiple,
        headers: await headers(owner.http),
        signal: AbortSignal.timeout(10000),
      })
    ).status,
  ).toBe(400);
  expect((await upload(owner.http, Buffer.from(source))).status).toBe(200);
});

it('未结束的实际上传占用预览租约，客户端取消后可用且不保存原文件', async () => {
  const owner = await verifiedCreator(stack);
  const boundary = 'native-file-held-boundary';
  let receiving: IncomingMessage | undefined;
  const observe = (request: IncomingMessage) => {
    if (request.headers['content-type'] === 'multipart/form-data; boundary=' + boundary)
      receiving = request;
  };
  stack.server.on('request', observe);
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="held.toml"\r\nContent-Type: application/octet-stream\r\n\r\n# waiting`,
  );
  const held = httpRequest(new URL(endpoint + '?format=maibot-toml', owner.http.base), {
    method: 'POST',
    headers: {
      ...(await headers(owner.http)),
      'Content-Type': 'multipart/form-data; boundary=' + boundary,
      'Content-Length': String(prefix.byteLength + 1000),
    },
  });
  held.on('error', () => undefined);
  held.on('response', (response) => response.resume());
  held.setTimeout(10000, () => held.destroy());
  held.write(prefix);
  try {
    // Multer 开始消费实际流后，前置租约已取得；避免竞争请求先抢走租约。
    await expect.poll(() => receiving?.readableFlowing, { timeout: 5000 }).toBe(true);
    expect((await upload(owner.http, Buffer.from(source))).status).toBe(503);
    expect(
      (
        await upload(
          owner.http,
          Buffer.from('原文'),
          '原文.txt',
          '',
          'auto',
          '/api/v1/me/persona-imports/text/source/file?format=text-plain',
        )
      ).status,
    ).toBe(503);
    const closed = new Promise<void>((resolve) => held.once('close', () => resolve()));
    held.destroy();
    await closed;
    await expect
      .poll(async () => (await upload(owner.http, Buffer.from(source))).status, {
        timeout: 5000,
        interval: 1000,
      })
      .toBe(200);
    expect(
      (
        await stack.owner.pool.query<{ total: number }>(
          "SELECT count(*)::integer AS total FROM persona_imports WHERE payload->>'filename'='held.toml'",
        )
      ).rows,
    ).toEqual([{ total: 0 }]);
  } finally {
    stack.server.off('request', observe);
    held.destroy();
  }
});
