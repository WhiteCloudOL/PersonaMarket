import { moderatePersona } from '../fixtures/admin-persona-moderation.js';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';
import {
  AssetResponseSchema,
  SubmissionResponseSchema,
  DraftResponseSchema,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator, completePersona } from '../fixtures/creator.js';
import { fixturePng } from '../fixtures/image.js';
let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeAll(async () => {
  stack = await createAuthStack();
});
afterAll(async () => {
  await stack?.close();
});
it('未审素材与证据不能公开，历史素材准确，封禁关闭所有公开图片入口', async () => {
  const owner = await verifiedCreator(stack);
  const other = await verifiedCreator(stack);
  const admin = await stack.admin();
  const created = await completePersona(owner.http);
  const path = '/api/v1/me/personas/' + created.id;
  const upload = async (purpose: 'content' | 'evidence') => {
    const context = await owner.http.context();
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(fixturePng)], { type: 'image/png' }), 'fixture.png');
    const response = await fetch(owner.http.base + '/api/v1/me/assets/upload/' + purpose, {
      method: 'POST',
      headers: {
        Cookie: [...owner.http.cookies].map(([k, v]) => k + '=' + v).join('; '),
        Origin: owner.http.origin,
        'X-CSRF-Token': context.data.csrfToken,
      },
      body: form,
    });
    expect(response.status).toBe(200);
    return AssetResponseSchema.parse(await response.json()).data.id;
  };
  const content = await upload('content');
  const proof = await upload('evidence');
  const orphan = await upload('content');
  const draft = {
    ...created.draft,
    readmeMarkdown: '![封面](asset://' + content + ')',
    avatarAssetId: content,
    evidenceAssetIds: [proof],
  };
  expect(
    (await owner.http.write(path + '/draft', draft, 'PUT', { 'If-Match': '"draft-2"' })).status,
  ).toBe(200);
  const submit = async (version: string, expected: number) => {
    const result = await owner.http.write(
      path + '/releases',
      { version, expectedDraftRevision: expected, confirmed: true, changelog: '真实图片发布' },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(result.status).toBe(200);
    return SubmissionResponseSchema.parse(await result.json()).data;
  };
  const first = await submit('1.0.0', 3);
  const publicImage = '/api/v1/public/assets/' + content;
  expect((await stack.browser().raw(publicImage)).status).toBe(404);
  expect((await other.http.raw('/api/v1/me/assets/' + content)).status).toBe(404);
  expect((await owner.http.raw('/api/v1/moderation/assets/' + proof)).status).toBe(403);
  expect((await admin.http.raw('/api/v1/moderation/assets/' + proof)).status).toBe(200);
  expect((await admin.http.raw('/api/v1/moderation/assets/' + orphan)).status).toBe(404);
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/moderation/submissions/' + first.id + '/review',
        {
          action: 'approve',
          expectedRevision: 1,
          reason: '已核验素材',
          selfReviewConfirmed: false,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  expect((await stack.browser().raw(publicImage)).status).toBe(200);
  await expect(
    stack.owner.pool.query(
      "DELETE FROM asset_references WHERE resource_id=$1 AND resource_type='submission'",
      [first.id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    stack.owner.pool.query('UPDATE release_submissions SET id=$1 WHERE id=$2', [
      randomUUID(),
      first.id,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  expect((await stack.browser().raw('/api/v1/public/assets/' + proof)).status).toBe(404);
  const current = DraftResponseSchema.parse(await (await owner.http.raw(path + '/draft')).json());
  expect(
    (
      await owner.http.write(
        path + '/draft',
        {
          ...current.data.draft,
          avatarAssetId: orphan,
          readmeMarkdown: '![新图片](asset://' + orphan + ')',
        },
        'PUT',
        { 'If-Match': '"draft-3"' },
      )
    ).status,
  ).toBe(200);
  const second = await submit('2.0.0', 4);
  expect((await stack.browser().raw('/api/v1/public/assets/' + orphan)).status).toBe(404);
  expect((await stack.browser().raw(publicImage)).status).toBe(200);
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/moderation/submissions/' + second.id + '/review',
        {
          action: 'approve',
          expectedRevision: 1,
          reason: '已核验新版',
          selfReviewConfirmed: false,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  expect((await stack.browser().raw(publicImage)).status).toBe(200);
  expect((await stack.browser().raw('/api/v1/public/assets/' + orphan)).status).toBe(200);
  expect((await admin.http.raw('/api/v1/moderation/assets/' + proof)).status).toBe(200);
  const foreignPersona = await completePersona(other.http);
  await expect(
    stack.owner.pool.query('UPDATE personas SET published_release_id=$1 WHERE id=$2', [
      second.releaseId,
      foreignPersona.id,
    ]),
  ).rejects.toMatchObject({ code: '23503' });
  await expect(
    stack.owner.pool.query(
      "INSERT INTO asset_references(asset_id,persona_id,resource_type,resource_id,purpose) VALUES($1,$2,'draft',$2,'content')",
      [content, foreignPersona.id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  expect(
    (
      await moderatePersona(admin.http, created.id, {
        state: 'blocked',
        reason: '访问隔离验证',
      })
    ).status,
  ).toBe(200);
  for (const asset of [content, orphan, proof])
    expect((await stack.browser().raw('/api/v1/public/assets/' + asset)).status).toBe(404);
  expect(
    (await stack.browser().raw('/api/v1/personas/' + created.id + '/releases/' + first.releaseId))
      .status,
  ).toBe(404);
});
