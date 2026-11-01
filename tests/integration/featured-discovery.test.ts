import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  AdminPersonaResponseSchema,
  PublicPersonaListResponseSchema,
  SubmissionResponseSchema,
  type Platform,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { completePersona, verifiedCreator } from '../fixtures/creator.js';
import type { AuthHttp } from '../fixtures/auth-http.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});
async function publish(owner: AuthHttp, admin: AuthHttp, platform: Platform) {
  const persona = await completePersona(owner, platform);
  const response = await owner.write(
    '/api/v1/me/personas/' + persona.id + '/releases',
    {
      version: '1.0.0',
      changelog: '精选筛选的真实公开版本',
      expectedDraftRevision: 2,
      confirmed: true,
    },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(response.status).toBe(200);
  const submission = SubmissionResponseSchema.parse(await response.json()).data;
  expect(
    (
      await admin.write(
        '/api/v1/admin/moderation/submissions/' + submission.id + '/review',
        {
          action: 'approve',
          expectedRevision: submission.revision,
          reason: '核对精选列表来源',
          selfReviewConfirmed: false,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  return persona;
}
async function current(admin: AuthHttp, id: string) {
  return AdminPersonaResponseSchema.parse(
    await (await admin.raw('/api/v1/admin/personas/' + id)).json(),
  ).data;
}
async function curate(admin: AuthHttp, id: string, featured: boolean) {
  const row = await current(admin, id);
  expect(
    (
      await admin.write(
        '/api/v1/admin/personas/' + id + '/curation',
        {
          featured,
          official: false,
          expectedRevision: row.revision,
          reason: '调整实际精选结果',
        },
        'PUT',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
}
async function listed(query = 'featured=true') {
  const response = await stack.browser().raw('/api/v1/personas?' + query);
  expect(response.status).toBe(200);
  return PublicPersonaListResponseSchema.parse(await response.json());
}

it('精选筛选来自真实策展，支持平台、分页和取消标记即时生效', async () => {
  const admin = await stack.admin();
  const owner = await verifiedCreator(stack);
  const first = await publish(owner.http, admin.http, 'maibot');
  const second = await publish(owner.http, admin.http, 'astrbot');
  expect((await listed()).meta.total).toBe(0);
  expect((await listed('featured=false')).meta.total).toBe(2);
  await curate(admin.http, first.id, true);
  await curate(admin.http, second.id, true);
  const pages = await Promise.all([
    listed('featured=true&pageSize=1&page=1'),
    listed('featured=true&pageSize=1&page=2'),
  ]);
  expect(pages.map((row) => row.meta.total)).toEqual([2, 2]);
  expect(new Set(pages.flatMap((row) => row.data.map((item) => item.personaId)))).toEqual(
    new Set([first.id, second.id]),
  );
  expect((await listed('featured=true&platform=astrbot')).data.map((row) => row.personaId)).toEqual(
    [second.id],
  );
  await curate(admin.http, first.id, false);
  expect((await listed()).data.map((row) => row.personaId)).toEqual([second.id]);
  expect((await listed('featured=false')).data.map((row) => row.personaId)).toEqual([first.id]);
  expect((await stack.browser().raw('/api/v1/personas?featured=yes')).status).toBe(400);
});

it('精选不会绕过作者隐藏或管理员下架，恢复公开资格后才重新进入结果', async () => {
  const admin = await stack.admin();
  const owner = await verifiedCreator(stack);
  const persona = await publish(owner.http, admin.http, 'maibot');
  await curate(admin.http, persona.id, true);
  expect((await listed()).meta.total).toBe(1);
  for (const visibility of ['hidden', 'listed'] as const) {
    expect(
      (
        await owner.http.write('/api/v1/me/personas/' + persona.id + '/visibility', {
          visibility,
          reason: '核对作者控制公开资格',
        })
      ).status,
    ).toBe(200);
    expect((await listed()).meta.total).toBe(visibility === 'hidden' ? 0 : 1);
  }
  for (const state of ['blocked', 'normal'] as const) {
    const row = await current(admin.http, persona.id);
    expect(
      (
        await admin.http.write(
          '/api/v1/admin/personas/' + persona.id + '/moderation',
          {
            state,
            expectedRevision: row.revision,
            reason: '核对管理员控制公开资格',
          },
          'POST',
          { 'Idempotency-Key': randomUUID() },
        )
      ).status,
    ).toBe(200);
    expect((await listed()).meta.total).toBe(state === 'blocked' ? 0 : 1);
  }
});
