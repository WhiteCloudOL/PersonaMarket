import { beforeAll, afterAll, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  MarketPersonaSchema,
  MarketImportPreviewResponseSchema,
  type MarketImportPreview,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator } from '../fixtures/creator.js';
import type { AuthHttp } from '../fixtures/auth-http.js';
import { marketPersona } from '../fixtures/market-personas.js';
import { fixturePng } from '../fixtures/image.js';
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
it('活跃图片确认可续期但最多一小时，不因图片限流窗口让有效预览提前失效', async () => {
  const owner = await verifiedCreator(stack);
  const document = imageDocument('https://images.fixture.invalid/original.png');
  for (const age of [16, 59]) {
    const response = await upload(
      owner.http,
      Buffer.from(JSON.stringify(document)),
      'active.persona.json',
    );
    expect(response.status).toBe(200);
    const preview = MarketImportPreviewResponseSchema.parse(await response.json()).data;
    const image = preview.images[0];
    if (!image) throw new Error('缺少图片');
    await stack.owner.pool.query(
      "UPDATE market_imports SET created_at=now()-make_interval(mins=>$2), expires_at=now()+interval '1 minute' WHERE id=$1",
      [preview.id, age],
    );
    const renewed =
      age === 16
        ? await upload(
            owner.http,
            fixturePng,
            'source.png',
            `/api/v1/me/market-imports/${preview.id}/images/${image.id}/upload`,
          )
        : await owner.http.write(
            `/api/v1/me/market-imports/${preview.id}/images/${image.id}/import-url`,
            {},
          );
    expect(renewed.status).toBe(200);
    const result = await stack.owner.pool.query<{ seconds: number }>(
      'SELECT extract(epoch from expires_at-now())::integer AS seconds FROM market_imports WHERE id=$1',
      [preview.id],
    );
    const seconds = result.rows[0]?.seconds ?? 0;
    if (age === 16) expect(seconds).toBeGreaterThan(29 * 60);
    else expect(seconds).toBeLessThanOrEqual(60);
    expect(
      (await owner.http.write('/api/v1/me/market-imports/' + preview.id, undefined, 'DELETE'))
        .status,
    ).toBe(200);
  }
});

it('普通素材和通用导入共享每账号三个在线图片任务上限，取消可释放名额', async () => {
  const owner = await verifiedCreator(stack);
  const previews: MarketImportPreview[] = [];
  for (let index = 0; index < 3; index++) {
    const response = await upload(
      owner.http,
      Buffer.from(JSON.stringify(imageDocument('https://images.fixture.invalid/source.png'))),
      'quota.persona.json',
    );
    expect(response.status).toBe(200);
    previews.push(MarketImportPreviewResponseSchema.parse(await response.json()).data);
  }
  const queue = (index: number) => {
    const preview = previews[index];
    const image = preview?.images[0];
    if (!preview || !image) throw new Error('缺少预览图片');
    return owner.http.write(
      `/api/v1/me/market-imports/${preview.id}/images/${image.id}/import-url`,
    );
  };
  const native = () =>
    owner.http.write('/api/v1/me/assets/import-url', {
      url: 'https://images.fixture.invalid/ordinary.png',
    });
  expect((await native()).status).toBe(200);
  const accepted = await Promise.all([queue(0), queue(1)]);
  expect(accepted.map((response) => response.status)).toEqual([200, 200]);
  expect((await native()).status).toBe(429);
  expect((await queue(2)).status).toBe(429);
  expect((await queue(0)).status).toBe(200);
  const discarded = previews[0];
  if (!discarded) throw new Error('缺少待取消预览');
  expect(
    (await owner.http.write('/api/v1/me/market-imports/' + discarded.id, undefined, 'DELETE'))
      .status,
  ).toBe(200);
  expect((await native()).status).toBe(200);
});
