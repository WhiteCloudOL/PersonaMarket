import { moderatePersona } from '../fixtures/admin-persona-moderation.js';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  AdminPersonaResponseSchema,
  AdminPersonasResponseSchema,
  SubmissionResponseSchema,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { completePersona, verifiedCreator } from '../fixtures/creator.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});

it('详情与筛选只返回管理元数据，稳定分页隔离作者并将搜索通配符当作普通文字', async () => {
  const admin = await stack.admin();
  const owner = await verifiedCreator(stack);
  const other = await verifiedCreator(stack);
  const first = await completePersona(owner.http);
  const second = await completePersona(owner.http, 'astrbot');
  await completePersona(other.http);
  const account = (await owner.http.context()).data.account;
  if (!account) throw new Error('测试账号未登录');
  const draft = { ...first.draft, title: '精确匹配%_的作品' };
  expect(
    (
      await owner.http.write('/api/v1/me/personas/' + first.id + '/draft', draft, 'PUT', {
        'If-Match': '"draft-2"',
      })
    ).status,
  ).toBe(200);
  const path = '/api/v1/admin/personas?ownerId=' + account.id;
  async function read(query = '') {
    const response = await admin.http.raw(path + query);
    expect(response.status).toBe(200);
    const result = AdminPersonasResponseSchema.parse(await response.json());
    for (const field of [
      'content',
      'payload',
      'readmeMarkdown',
      'email',
      'passwordHash',
      'requestId',
    ])
      expect(JSON.stringify(result)).not.toContain('"' + field + '"');
    return result;
  }
  const all = await read();
  expect(all.meta.total).toBe(2);
  expect(all.data.map((row) => row.id).sort()).toEqual([first.id, second.id].sort());
  const pages = [await read('&pageSize=1'), await read('&pageSize=1&page=2')];
  expect(pages.map((row) => row.data[0]?.id).sort()).toEqual([first.id, second.id].sort());
  expect(pages.map((row) => row.meta.total)).toEqual([2, 2]);
  expect((await read('&pageSize=1&page=3')).data).toEqual([]);
  expect((await read('&q=' + encodeURIComponent('%_'))).data.map((row) => row.id)).toEqual([
    first.id,
  ]);
  expect((await read('&q=' + encodeURIComponent('\\'))).meta.total).toBe(0);
  expect((await read('&q=' + second.id)).data.map((row) => row.id)).toEqual([second.id]);
  expect((await read('&platform=astrbot')).data.map((row) => row.id)).toEqual([second.id]);
  expect((await read('&state=public')).meta.total).toBe(0);
  expect((await read('&state=unpublished')).meta.total).toBe(2);
  expect((await read('&state=pending')).meta.total).toBe(0);
  const detail = await admin.http.raw('/api/v1/admin/personas/' + first.id);
  expect(detail.status).toBe(200);
  expect(detail.headers.get('cache-control')).toContain('no-store');
  expect(AdminPersonaResponseSchema.parse(await detail.json()).data).toEqual(
    all.data.find((row) => row.id === first.id),
  );
  expect((await admin.http.raw('/api/v1/admin/personas/' + randomUUID())).status).toBe(404);
  expect((await admin.http.raw('/api/v1/admin/personas/not-a-uuid')).status).toBe(400);
  expect(
    (
      await admin.http.raw('/api/v1/admin/personas/' + first.id, {
        headers: { 'X-Expected-Account': randomUUID() },
      })
    ).status,
  ).toBe(409);
});
afterEach(async () => {
  await stack?.close();
});

it('管理员按真实归属查看包含私有草稿的人设列表，普通浏览不要求近期验证且普通用户不可访问', async () => {
  const admin = await stack.admin();
  const owner = await verifiedCreator(stack);
  const created = await completePersona(owner.http);
  const account = (await owner.http.context()).data.account;
  const actor = (await admin.http.context()).data.account;
  if (!account || !actor) throw new Error('测试账号未登录');
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET created_at=now()-interval '20 minutes',mfa_verified_at=now()-interval '11 minutes' WHERE user_id=$1",
    [actor.id],
  );
  const path = '/api/v1/admin/personas?ownerId=' + account.id + '&platform=maibot';
  const response = await admin.http.raw(path);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    data: [
      {
        id: created.id,
        title: created.draft.title,
        platform: 'maibot',
        owner: { id: account.id, username: owner.username },
      },
    ],
    meta: { page: 1, pageSize: 20, total: 1 },
  });
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect((await owner.http.raw(path)).status).toBe(403);
  expect((await stack.browser().raw(path)).status).toBe(401);
  for (const query of ['state=invalid', 'pageSize=21', 'ownerId=not-a-user', 'q=%00'])
    expect((await admin.http.raw('/api/v1/admin/personas?' + query)).status).toBe(400);
});

it('按真实发布、待审、隐藏与下架状态筛选，继续编辑不改写管理列表中的冻结标题', async () => {
  const admin = await stack.admin();
  const owner = await verifiedCreator(stack);
  const first = await completePersona(owner.http);
  const second = await completePersona(owner.http, 'astrbot');
  const pending = await completePersona(owner.http);
  const privateDraft = await completePersona(owner.http);
  for (const [index, created] of [first, second, pending].entries()) {
    const response = await owner.http.write(
      '/api/v1/me/personas/' + created.id + '/releases',
      {
        version: '1.0.0',
        expectedDraftRevision: created.revision,
        changelog: '真实管理状态验证',
        confirmed: true,
      },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(response.status).toBe(200);
    const submission = SubmissionResponseSchema.parse(await response.json()).data;
    if (index < 2)
      expect(
        (
          await admin.http.write(
            '/api/v1/admin/moderation/submissions/' + submission.id + '/review',
            {
              action: 'approve',
              expectedRevision: submission.revision,
              reason: '核对真实作品',
              selfReviewConfirmed: false,
            },
            'POST',
            { 'Idempotency-Key': randomUUID() },
          )
        ).status,
      ).toBe(200);
    expect(
      (
        await owner.http.write(
          '/api/v1/me/personas/' + created.id + '/draft',
          {
            ...created.draft,
            title: '尚未提交的私密修订标题',
          },
          'PUT',
          { 'If-Match': '"draft-2"' },
        )
      ).status,
    ).toBe(200);
  }
  const account = (await owner.http.context()).data.account;
  if (!account) throw new Error('测试账号未登录');
  const path = '/api/v1/admin/personas?ownerId=' + account.id;
  async function read(state: string) {
    const response = await admin.http.raw(path + '&state=' + state);
    expect(response.status).toBe(200);
    return AdminPersonasResponseSchema.parse(await response.json());
  }
  expect((await read('all')).data.map((row) => row.id).sort()).toEqual(
    [first.id, second.id, pending.id, privateDraft.id].sort(),
  );
  const published = await read('public');
  expect(published.data.map((row) => row.id).sort()).toEqual([first.id, second.id].sort());
  expect(published.data.map((row) => row.title)).toEqual([first.draft.title, second.draft.title]);
  const categoryId = published.data[0]?.category?.id;
  if (!categoryId) throw new Error('真实发布缺少分类元数据');
  const category = await admin.http.raw(path + '&state=public&categoryId=' + categoryId);
  expect(category.status).toBe(200);
  expect(AdminPersonasResponseSchema.parse(await category.json()).meta.total).toBe(2);
  expect((await read('pending')).data).toMatchObject([
    { id: pending.id, title: pending.draft.title, pendingCount: 1 },
  ]);
  expect(
    (
      await owner.http.write('/api/v1/me/personas/' + first.id + '/visibility', {
        visibility: 'hidden',
        reason: '作者临时隐藏',
      })
    ).status,
  ).toBe(200);
  expect((await read('hidden')).data.map((row) => row.id)).toEqual([first.id]);
  expect((await read('public')).data.map((row) => row.id)).toEqual([second.id]);
  expect(
    (
      await moderatePersona(admin.http, second.id, {
        state: 'blocked',
        reason: '管理状态验证',
      })
    ).status,
  ).toBe(200);
  expect((await read('blocked')).data.map((row) => row.id)).toEqual([second.id]);
  expect((await read('public')).meta.total).toBe(0);
  expect((await read('unpublished')).meta.total).toBe(4);
});
