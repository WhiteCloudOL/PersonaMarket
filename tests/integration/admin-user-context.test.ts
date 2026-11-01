import { moderatePersona } from '../fixtures/admin-persona-moderation.js';
import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import {
  PublicPersonaListResponseSchema,
  SubmissionResponseSchema,
  AdminUserResponseSchema,
  AdminUserReviewRecordsResponseSchema,
  CommentResponseSchema,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator, completePersona } from '../fixtures/creator.js';
import type { AuthHttp } from '../fixtures/auth-http.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});

async function publish(
  owner: AuthHttp,
  reviewer: AuthHttp,
  platform: 'maibot' | 'astrbot' = 'maibot',
) {
  const created = await completePersona(owner, platform);
  const response = await owner.write(
    '/api/v1/me/personas/' + created.id + '/releases',
    {
      version: '1.0.0',
      expectedDraftRevision: created.revision,
      changelog: '管理归属验证',
      confirmed: true,
    },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(response.status).toBe(200);
  const submission = SubmissionResponseSchema.parse(await response.json()).data;
  expect(
    (
      await reviewer.write(
        '/api/v1/admin/moderation/submissions/' + submission.id + '/review',
        {
          action: 'approve',
          expectedRevision: submission.revision,
          reason: '核对真实作品归属',
          selfReviewConfirmed: false,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  return { ...created, submission };
}

describe('真实公开作品归属与实时可见性', () => {
  let context: Awaited<ReturnType<typeof prepare>>;
  async function prepare() {
    const admin = await stack.admin();
    const target = await verifiedCreator(stack);
    const other = await verifiedCreator(stack);
    const first = await publish(target.http, admin.http);
    const second = await publish(target.http, admin.http, 'astrbot');
    const unrelated = await publish(other.http, admin.http);
    const privateDraft = await completePersona(target.http);
    const account = (await target.http.context()).data.account;
    if (!account) throw new Error('目标用户未登录');
    return {
      admin,
      target,
      other,
      first,
      second,
      unrelated,
      privateDraft,
      account,
      path: '/api/v1/admin/users/' + account.id + '/public-personas',
    };
  }
  beforeEach(async () => {
    context = await prepare();
  });
  it('同标题的其他作者和私有草稿不混入，两个平台分页完整，隐藏/下架实时排除，账号封禁不隐含作品下架', async () => {
    const { admin, target, first, second, account, path } = context;
    async function read(query = '') {
      const response = await admin.http.raw(path + query);
      expect(response.status).toBe(200);
      const result = PublicPersonaListResponseSchema.parse(await response.json());
      for (const secret of ['readmeMarkdown', 'content', 'passwordHash', 'email', 'requestId'])
        expect(JSON.stringify(result)).not.toContain('"' + secret + '"');
      return result;
    }
    const initial = await read();
    expect(initial.meta.total).toBe(2);
    expect(initial.data.map((row) => row.personaId).sort()).toEqual([first.id, second.id].sort());
    expect(initial.data.map((row) => row.snapshot.platform).sort()).toEqual(['astrbot', 'maibot']);
    const pages = [await read('?pageSize=1'), await read('?page=2&pageSize=1')];
    expect(pages.map((page) => page.data[0]?.personaId).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(pages.map((page) => page.meta.total)).toEqual([2, 2]);
    expect(
      (
        await target.http.write('/api/v1/me/personas/' + first.id + '/visibility', {
          visibility: 'hidden',
          reason: '作者暂时隐藏',
        })
      ).status,
    ).toBe(200);
    expect((await read()).data.map((row) => row.personaId)).toEqual([second.id]);
    expect(
      (
        await moderatePersona(admin.http, second.id, {
          state: 'blocked',
          reason: '管理可见性验证',
        })
      ).status,
    ).toBe(200);
    expect((await read()).data).toEqual([]);
    expect(
      (
        await target.http.write('/api/v1/me/personas/' + first.id + '/visibility', {
          visibility: 'listed',
          reason: '恢复作者展示',
        })
      ).status,
    ).toBe(200);
    const user = AdminUserResponseSchema.parse(
      await (await admin.http.raw('/api/v1/admin/users/' + account.id)).json(),
    ).data;
    expect(
      (
        await admin.http.write(
          '/api/v1/admin/users/' + account.id + '/status',
          {
            status: 'banned',
            expectedSecurityVersion: user.securityVersion,
            reason: '仅封账号保持作品独立',
          },
          'PUT',
          { 'Idempotency-Key': randomUUID() },
        )
      ).status,
    ).toBe(200);
    expect((await read()).data.map((row) => row.personaId)).toEqual([first.id]);
  });
  it('合并本人作品和本人评论的真实审核记录，完整分页且隔离他人正文与审核理由', async () => {
    const { admin, target, other, first, second, unrelated, account } = context;
    async function comment(owner: AuthHttp, personaId: string, body: string, reason: string) {
      const response = await owner.write(
        '/api/v1/personas/' + personaId + '/comments',
        { body },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      );
      expect(response.status).toBe(200);
      const row = CommentResponseSchema.parse(await response.json()).data;
      expect(
        (
          await admin.http.write(
            '/api/v1/admin/comments/' + row.id + '/review',
            {
              revisionId: row.latest.id,
              expectedRevision: row.revision,
              decision: 'approve',
              reason,
            },
            'POST',
            { 'Idempotency-Key': randomUUID() },
          )
        ).status,
      ).toBe(200);
      return row;
    }
    const ownReason = '本人评论的完整审核理由\n<img src=x onerror=alert(1)>';
    const own = await comment(target.http, unrelated.id, '只在评论详情读取的目标正文', ownReason);
    const others = await comment(
      other.http,
      first.id,
      '不得混入目标历史的他人正文',
      '不得混入目标历史的他人处理理由',
    );
    const path = '/api/v1/admin/users/' + account.id + '/review-records';
    async function read(query = '') {
      const response = await admin.http.raw(path + query);
      expect(response.status).toBe(200);
      const result = AdminUserReviewRecordsResponseSchema.parse(await response.json());
      const json = JSON.stringify(result);
      for (const forbidden of [
        '只在评论详情读取的目标正文',
        '不得混入目标历史的他人正文',
        '不得混入目标历史的他人处理理由',
        '"requestId"',
        '"body"',
        '"email"',
      ])
        expect(json).not.toContain(forbidden);
      return result;
    }
    const all = await read();
    expect(all.meta.total).toBe(5);
    expect(
      all.data
        .filter((row) => row.kind === 'persona')
        .map((row) => row.personaId)
        .sort(),
    ).toEqual([first.id, first.id, second.id, second.id].sort());
    const comments = await read('?kind=comment');
    expect(comments.meta.total).toBe(1);
    expect(comments.data[0]).toMatchObject({
      kind: 'comment',
      commentId: own.id,
      reason: ownReason,
      actor: { username: admin.credentials.username },
    });
    expect(JSON.stringify(all)).not.toContain(others.id);
    const ids: string[] = [];
    for (let page = 1; page <= 5; page++) {
      const result = await read('?pageSize=1&page=' + page);
      expect(result.meta.total).toBe(5);
      const row = result.data[0];
      if (!row) throw new Error('历史分页丢失记录');
      ids.push(row.kind + ':' + row.id);
    }
    expect(new Set(ids).size).toBe(5);
    expect(new Set(ids)).toEqual(new Set(all.data.map((row) => row.kind + ':' + row.id)));
    for (const query of ['kind=unknown', 'page=501', 'actorId=' + account.id])
      expect((await admin.http.raw(path + '?' + query)).status).toBe(400);
    const otherAccount = (await other.http.context()).data.account;
    if (!otherAccount) throw new Error('参照用户未登录');
    const before = AdminUserResponseSchema.parse(
      await (await admin.http.raw('/api/v1/admin/users/' + otherAccount.id)).json(),
    ).data;
    expect(
      (
        await admin.http.write(
          '/api/v1/admin/users/' + otherAccount.id + '/role',
          {
            role: 'moderator',
            expectedSecurityVersion: before.securityVersion,
            reason: '验证审核员权限边界',
          },
          'PUT',
          { 'Idempotency-Key': randomUUID() },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await other.http.write('/api/v1/auth/login', {
          identifier: other.username,
          password: other.password,
        })
      ).status,
    ).toBe(200);
    expect((await other.http.raw(path)).status).toBe(403);
    expect((await other.http.raw(context.path)).status).toBe(403);
    const actor = (await admin.http.context()).data.account;
    if (!actor) throw new Error('管理员未登录');
    await stack.owner.pool.query(
      "UPDATE auth_sessions SET created_at=now()-interval '20 minutes',mfa_verified_at=now()-interval '11 minutes' WHERE user_id=$1",
      [actor.id],
    );
    expect((await read()).meta.total).toBe(5);
  });
});

it('管理员查看用户审核与处置记录的空状态，普通用户不能读取他人管理历史', async () => {
  const admin = await stack.admin();
  const creator = await verifiedCreator(stack);
  const account = (await creator.http.context()).data.account;
  if (!account) throw new Error('目标用户未登录');
  const path = '/api/v1/admin/users/' + account.id + '/review-records';
  const response = await admin.http.raw(path);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    data: [],
    meta: { page: 1, pageSize: 20, total: 0 },
  });
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect((await creator.http.raw(path)).status).toBe(403);
  expect((await stack.browser().raw(path)).status).toBe(401);
});
afterEach(async () => {
  await stack?.close();
});

it('管理员按稳定用户ID查看公开作品，过期近期凭据可浏览，普通用户不可读取管理入口', async () => {
  const admin = await stack.admin();
  const creator = await verifiedCreator(stack);
  const account = (await creator.http.context()).data.account;
  const actor = (await admin.http.context()).data.account;
  if (!account || !actor) throw new Error('测试账号未登录');
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET created_at=now()-interval '20 minutes',mfa_verified_at=now()-interval '11 minutes' WHERE user_id=$1",
    [actor.id],
  );
  const path = '/api/v1/admin/users/' + account.id + '/public-personas';
  const response = await admin.http.raw(path);
  expect(response.status).toBe(200);
  expect(PublicPersonaListResponseSchema.parse(await response.json())).toMatchObject({
    data: [],
    meta: { page: 1, pageSize: 20, total: 0 },
  });
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect((await creator.http.raw(path)).status).toBe(403);
  expect((await stack.browser().raw(path)).status).toBe(401);
  expect(
    (await admin.http.raw('/api/v1/admin/users/' + randomUUID() + '/public-personas')).status,
  ).toBe(404);
  for (const query of [
    'page=0',
    'page=501',
    'pageSize=21',
    'ownerId=' + actor.id,
    'sort=password_hash',
  ])
    expect((await admin.http.raw(path + '?' + query)).status).toBe(400);
});
