import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { DraftResponseSchema, MyPersonasResponseSchema } from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeAll(async () => {
  stack = await createAuthStack();
});
afterAll(async () => {
  await stack?.close();
});
async function author() {
  const username = 'draft_' + randomUUID().replaceAll('-', '').slice(0, 12);
  const http = stack.browser();
  const password = 'Draft creation passphrase 2026';
  expect(
    (
      await http.write('/api/v1/auth/register', {
        username,
        email: username + '@fixture.invalid',
        password,
      })
    ).status,
  ).toBe(200);
  expect((await http.write('/api/v1/auth/login', { identifier: username, password })).status).toBe(
    200,
  );
  return { http, username };
}
it('两平台真实创建和不完整草稿保存，作者隔离、平台不可变、并发 ETag 与硬边界', async () => {
  const { http, username } = await author();
  const stranger = await author();
  expect((await stack.browser().raw('/api/v1/me/personas')).status).toBe(401);
  expect(
    (
      await http.write('/api/v1/me/personas', {
        platform: 'maibot',
        title: '伪造作者',
        ownerId: randomUUID(),
      })
    ).status,
  ).toBe(400);
  for (const platform of ['maibot', 'astrbot'] as const) {
    const created = await http.write('/api/v1/me/personas', { platform, title: '创作中的人设' });
    expect(created.status).toBe(200);
    let value = DraftResponseSchema.parse(await created.json());
    expect(value.data.draft.platform).toBe(platform);
    const path = '/api/v1/me/personas/' + value.data.id + '/draft';
    expect((await stranger.http.raw(path)).status).toBe(404);
    const draft = { ...value.data.draft, summary: '真实服务器草稿，保留空白和 Unicode 🦆' };
    if (draft.platform === 'maibot') draft.content.personality = '  中文人格\n原样保留  ';
    else draft.content.dialoguePairs = [{ id: randomUUID(), user: '暂未填写助手', assistant: '' }];
    const response = await http.write(path, draft, 'PUT', { 'If-Match': '"draft-1"' });
    expect(response.status).toBe(200);
    value = DraftResponseSchema.parse(await response.json());
    expect(value.data.draft).toEqual(draft);
    expect(value.meta.revision).toBe(2);
    expect(DraftResponseSchema.parse(await (await http.raw(path)).json())).toEqual(value);
    expect((await http.write(path, draft, 'PUT', { 'If-Match': '"draft-1"' })).status).toBe(412);
    const concurrent = await Promise.all([
      http.write(path, { ...draft, title: '并发甲' }, 'PUT', { 'If-Match': '"draft-2"' }),
      http.write(path, { ...draft, title: '并发乙' }, 'PUT', { 'If-Match': '"draft-2"' }),
    ]);
    expect(concurrent.map((r) => r.status).sort()).toEqual([200, 412]);
    expect(
      (
        await http.write(
          path,
          { ...draft, platform: platform === 'maibot' ? 'astrbot' : 'maibot' },
          'PUT',
          { 'If-Match': '"draft-3"' },
        )
      ).status,
    ).toBe(400);
    expect(
      (await stranger.http.write(path, draft, 'PUT', { 'If-Match': '"draft-3"' })).status,
    ).toBe(404);
    await expect(
      stack.owner.pool.query('UPDATE personas SET platform=$1 WHERE id=$2', [
        platform === 'maibot' ? 'astrbot' : 'maibot',
        value.data.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  }
  const list = MyPersonasResponseSchema.parse(await (await http.raw('/api/v1/me/personas')).json());
  expect(list.meta.total).toBe(2);
  expect(
    MyPersonasResponseSchema.parse(await (await stranger.http.raw('/api/v1/me/personas')).json())
      .meta.total,
  ).toBe(0);
  const id = list.data[0]?.id;
  if (!id) throw new Error('缺少草稿');
  const value = DraftResponseSchema.parse(
    await (await http.raw('/api/v1/me/personas/' + id + '/draft')).json(),
  );
  expect(
    (
      await http.write(
        '/api/v1/me/personas/' + id + '/draft',
        { ...value.data.draft, title: 'x'.repeat(81) },
        'PUT',
        { 'If-Match': '"draft-3"' },
      )
    ).status,
  ).toBe(400);
  await stack.owner.pool.query("UPDATE users SET status='banned' WHERE username=$1", [username]);
  expect((await http.raw('/api/v1/me/personas/' + id + '/draft')).status).toBe(401);
});
