import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { AssetResponseSchema, AssetJobResponseSchema } from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { fixturePng } from '../fixtures/image.js';
let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeAll(async () => {
  stack = await createAuthStack();
});
afterAll(async () => {
  await stack?.close();
});
it('真实 multipart 上传、私有图片和授权证据隔离、内容嗅探与异步 SSRF 拒绝', async () => {
  const http = stack.browser();
  const username = 'image_' + randomUUID().replaceAll('-', '').slice(0, 12);
  const email = username + '@fixture.invalid';
  const password = 'Real image fixture password 2026';
  expect((await http.register({ username, email, password }, stack.tick)).status).toBe(200);
  expect((await http.write('/api/v1/auth/login', { identifier: username, password })).status).toBe(
    200,
  );
  const context = await http.context();
  const cookies = [...http.cookies].map(([key, value]) => key + '=' + value).join('; ');
  const upload = async (purpose: string, bytes: Buffer, type: string) => {
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(bytes)], { type }), 'untrusted.svg');
    return fetch(http.base + '/api/v1/me/assets/upload/' + purpose, {
      method: 'POST',
      headers: { Cookie: cookies, Origin: http.origin, 'X-CSRF-Token': context.data.csrfToken },
      body: form,
    });
  };
  const response = await upload('content', fixturePng, 'image/svg+xml');
  expect(response.status).toBe(200);
  const asset = AssetResponseSchema.parse(await response.json()).data;
  expect(asset.mime).toBe('image/webp');
  const image = await http.raw('/api/v1/me/assets/' + asset.id);
  expect(image.status).toBe(200);
  expect(image.headers.get('cache-control')).toContain('no-store');
  expect(Buffer.from(await image.arrayBuffer()).includes(Buffer.from('private metadata'))).toBe(
    false,
  );
  expect((await stack.browser().raw('/api/v1/me/assets/' + asset.id)).status).toBe(401);
  expect((await http.raw('/api/v1/public/assets/' + asset.id)).status).toBe(404);
  const evidence = await upload('evidence', fixturePng, 'image/png');
  expect(evidence.status).toBe(200);
  expect((await upload('content', Buffer.from('<svg/>'), 'image/png')).status).toBe(400);
  expect((await upload('content', Buffer.alloc(5242881), 'image/png')).status).toBe(413);
  const rejected = await http.write('/api/v1/me/assets/import-url', {
    url: 'https://127.0.0.1/a.png',
  });
  expect(rejected.status).toBe(400);
  const queued = await http.write('/api/v1/me/assets/import-url', {
    url: 'https://localhost/a.png',
  });
  expect(queued.status).toBe(200);
  const job = AssetJobResponseSchema.parse(await queued.json()).data;
  await expect
    .poll(async () => {
      await stack.tick();
      return AssetJobResponseSchema.parse(
        await (await http.raw('/api/v1/me/asset-jobs/' + job.id)).json(),
      ).data.status;
    })
    .toBe('failed');
  expect((await stack.browser().raw('/api/v1/me/asset-jobs/' + job.id)).status).toBe(401);
});
