import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  AssetResponseSchema,
  AdminUserResponseSchema,
  OwnProfileResponseSchema,
  ProfileSubmissionResponseSchema,
  ModerationProfileResponseSchema,
  ProfileVisibilityResponseSchema,
  PublicCreatorResponseSchema,
  ErrorResponseSchema,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator } from '../fixtures/creator.js';
import { fixturePng } from '../fixtures/image.js';
import type { AuthHttp } from '../fixtures/auth-http.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});
const nonce = () => ({ 'Idempotency-Key': randomUUID() });
const ownRoute = '/api/v1/me/profile';
const content = {
  displayName: '公开资料作者',
  bio: '真实审核后才展示',
  avatarAssetId: null,
  links: [],
};
it('头像上传在写入文件和数据库前核对预期账号，阻断跨窗口换号后的旧输入', async () => {
  const creator = await verifiedCreator(stack),
    other = await verifiedCreator(stack);
  const auth = await creator.http.context(),
    expected = (await other.http.context()).data.account;
  if (!expected) throw Error('缺少实际对照账号');
  const before = (await stack.owner.pool.query('SELECT count(*)::int AS count FROM assets')).rows[0]
    ?.count;
  if (typeof before !== 'number' || !auth.data.account) throw Error('缺少真实账号或素材计数');
  async function storageFiles() {
    try {
      return (await readdir(stack.env.STORAGE_ROOT, { recursive: true })).sort();
    } catch (cause) {
      if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return [];
      throw cause;
    }
  }
  const beforeFiles = await storageFiles();
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(fixturePng)], { type: 'image/png' }), 'fixture.png');
  const response = await fetch(creator.http.base + '/api/v1/me/assets/upload/avatar', {
    method: 'POST',
    headers: {
      Cookie: [...creator.http.cookies].map(([key, value]) => key + '=' + value).join('; '),
      Origin: creator.http.origin,
      'X-CSRF-Token': auth.data.csrfToken,
      'X-Expected-Account': expected.id,
    },
    body: form,
  });
  expect(response.status).toBe(409);
  expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe('CONFLICT');
  expect(
    (await stack.owner.pool.query('SELECT count(*)::int AS count FROM assets')).rows[0]?.count,
  ).toBe(before);
  expect(await storageFiles()).toEqual(beforeFiles);
  const acceptedBody = new FormData();
  acceptedBody.set(
    'file',
    new Blob([new Uint8Array(fixturePng)], { type: 'image/png' }),
    'fixture.png',
  );
  const accepted = await fetch(creator.http.base + '/api/v1/me/assets/upload/avatar', {
    method: 'POST',
    headers: {
      Cookie: [...creator.http.cookies].map(([key, value]) => key + '=' + value).join('; '),
      Origin: creator.http.origin,
      'X-CSRF-Token': auth.data.csrfToken,
      'X-Expected-Account': auth.data.account.id,
    },
    body: acceptedBody,
  });
  expect(accepted.status).toBe(200);
  expect(AssetResponseSchema.parse(await accepted.json()).data.purpose).toBe('avatar');
  expect(
    (await stack.owner.pool.query('SELECT count(*)::int AS count FROM assets')).rows[0]?.count,
  ).toBe(before + 1);
});
it('资料输入超出持久化字节预算或含不完整字符时返回400，不写入草稿', async () => {
  const creator = await verifiedCreator(stack);
  const links = Array.from({ length: 5 }, (_, index) => ({
    label: '网站',
    url: 'https://example.invalid/' + '界'.repeat(1900) + index,
  }));
  for (const value of [
    { ...content, links },
    { ...content, bio: '简介\uD800' },
    { ...content, displayName: '作者\uD800' },
  ]) {
    expect(
      (await creator.http.write(ownRoute, { content: value, expectedRevision: 0 }, 'PUT')).status,
    ).toBe(400);
  }
  expect(
    OwnProfileResponseSchema.parse(await (await creator.http.raw(ownRoute)).json()).data.revision,
  ).toBe(0);
});
async function upload(http: AuthHttp) {
  const context = await http.context(),
    form = new FormData();
  form.set('file', new Blob([new Uint8Array(fixturePng)], { type: 'image/png' }), 'fixture.png');
  const response = await fetch(http.base + '/api/v1/me/assets/upload/avatar', {
    method: 'POST',
    headers: {
      Cookie: [...http.cookies].map(([key, value]) => key + '=' + value).join('; '),
      Origin: http.origin,
      'X-CSRF-Token': context.data.csrfToken,
    },
    body: form,
  });
  expect(response.status).toBe(200);
  const data = AssetResponseSchema.parse(await response.json()).data;
  expect(data.purpose).toBe('avatar');
  expect(data.mime).toBe('image/webp');
  return data.id;
}
async function submit(http: AuthHttp, revision: number) {
  const response = await http.write(
    ownRoute + '/submissions',
    { expectedDraftRevision: revision, confirmed: true },
    'POST',
    nonce(),
  );
  expect(response.status).toBe(200);
  return ProfileSubmissionResponseSchema.parse(await response.json()).data;
}
async function approve(http: AuthHttp, id: string) {
  const response = await http.write(
    '/api/v1/admin/profiles/submissions/' + id + '/review',
    {
      decision: 'approve',
      expectedRevision: 1,
      reason: '核对真实资料与头像',
      selfReviewConfirmed: false,
    },
    'POST',
    nonce(),
  );
  expect(response.status).toBe(200);
  return ModerationProfileResponseSchema.parse(await response.json()).data;
}

it('待审头像不公开，替换、资料下架和账号封禁立即关闭旧头像地址', async () => {
  const creator = await verifiedCreator(stack),
    other = await verifiedCreator(stack),
    admin = await stack.admin(),
    anonymous = stack.browser();
  const ownerId = (await creator.http.context()).data.account?.id;
  const firstAvatar = await upload(creator.http);
  expect(
    (
      await creator.http.write(
        ownRoute,
        { content: { ...content, avatarAssetId: firstAvatar }, expectedRevision: 0 },
        'PUT',
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await other.http.write(
        ownRoute,
        { content: { ...content, avatarAssetId: firstAvatar }, expectedRevision: 0 },
        'PUT',
      )
    ).status,
  ).toBe(404);
  expect((await other.http.raw('/api/v1/me/assets/' + firstAvatar)).status).toBe(404);
  const first = await submit(creator.http, 1),
    firstUrl = '/api/v1/users/' + creator.username + '/avatar/' + first.id,
    reviewAvatar = '/api/v1/admin/profiles/submissions/' + first.id + '/avatar';
  expect((await anonymous.raw(firstUrl)).status).toBe(404);
  expect((await anonymous.raw('/api/v1/public/assets/' + firstAvatar)).status).toBe(404);
  expect((await other.http.raw(reviewAvatar)).status).toBe(403);
  expect((await admin.http.raw(reviewAvatar)).status).toBe(200);
  await approve(admin.http, first.id);
  const firstImage = await anonymous.raw(firstUrl);
  expect(firstImage.status).toBe(200);
  expect(firstImage.headers.get('cache-control')).toContain('no-store');
  const image = Buffer.from(await firstImage.arrayBuffer());
  expect(image.subarray(0, 4).toString()).toBe('RIFF');
  expect(image.subarray(8, 12).toString()).toBe('WEBP');
  expect((await anonymous.raw('/api/v1/public/assets/' + firstAvatar)).status).toBe(404);

  const secondAvatar = await upload(creator.http);
  expect(
    (
      await creator.http.write(
        ownRoute,
        {
          content: { ...content, displayName: '审核后的新资料', avatarAssetId: secondAvatar },
          expectedRevision: 1,
        },
        'PUT',
      )
    ).status,
  ).toBe(200);
  const second = await submit(creator.http, 2),
    secondUrl = '/api/v1/users/' + creator.username + '/avatar/' + second.id;
  expect((await anonymous.raw(firstUrl)).status).toBe(200);
  expect((await anonymous.raw(secondUrl)).status).toBe(404);
  const approved = await approve(admin.http, second.id);
  expect((await anonymous.raw(firstUrl)).status).toBe(404);
  expect((await anonymous.raw(secondUrl)).status).toBe(200);
  const visibilityRoute = '/api/v1/admin/profiles/' + ownerId + '/visibility';
  const hidden = await admin.http.write(
    visibilityRoute,
    {
      hidden: true,
      expectedRevision: approved.currentProfile.revision,
      reason: '本次隔离测试核验资料下架',
      selfReviewConfirmed: false,
    },
    'POST',
    nonce(),
  );
  expect(hidden.status).toBe(200);
  const state = ProfileVisibilityResponseSchema.parse(await hidden.json()).data;
  const fallback = PublicCreatorResponseSchema.parse(
    await (await anonymous.raw('/api/v1/users/' + creator.username)).json(),
  ).data;
  expect(fallback.displayName).toBe(creator.username);
  expect(fallback.bio).toBe('');
  expect(fallback.avatarUrl).toBeNull();
  expect(fallback.approvedRevisionId).toBeNull();
  expect((await anonymous.raw(secondUrl)).status).toBe(404);
  expect(
    (
      await admin.http.write(
        visibilityRoute,
        {
          hidden: false,
          expectedRevision: state.revision,
          reason: '已完成核验并恢复资料',
          selfReviewConfirmed: false,
        },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(200);
  expect((await anonymous.raw(secondUrl)).status).toBe(200);
  const user = AdminUserResponseSchema.parse(
    await (await admin.http.raw('/api/v1/admin/users/' + ownerId)).json(),
  ).data;
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/users/' + ownerId + '/status',
        {
          status: 'banned',
          scope: 'account_only',
          expectedSecurityVersion: user.securityVersion,
          reason: '隔离测试验证封禁后头像资格',
        },
        'PUT',
        nonce(),
      )
    ).status,
  ).toBe(200);
  expect((await anonymous.raw('/api/v1/users/' + creator.username)).status).toBe(404);
  expect((await anonymous.raw(secondUrl)).status).toBe(404);
  expect((await anonymous.raw(firstUrl)).status).toBe(404);
});

it('资料API拒绝越权字段和CSRF，保存、提交与审核并发只有一份生效', async () => {
  const creator = await verifiedCreator(stack),
    other = await verifiedCreator(stack),
    admin = await stack.admin();
  const ownId = (await creator.http.context()).data.account?.id;
  expect((await other.http.raw('/api/v1/admin/profiles/submissions')).status).toBe(403);
  expect(
    (await creator.http.write(ownRoute, { content, expectedRevision: 0, userId: ownId }, 'PUT'))
      .status,
  ).toBe(400);
  expect(
    (
      await other.http.write(ownRoute, { content, expectedRevision: 0 }, 'PUT', {
        'X-Expected-Account': ownId ?? '',
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await other.http.raw(ownRoute, {
        method: 'PUT',
        headers: { Origin: other.http.origin },
        body: JSON.stringify({ content, expectedRevision: 0 }),
      })
    ).status,
  ).toBe(403);
  expect(
    OwnProfileResponseSchema.parse(await (await other.http.raw(ownRoute)).json()).data.revision,
  ).toBe(0);
  const saves = await Promise.all(
    ['一', '二'].map((bio) =>
      creator.http.write(ownRoute, { content: { ...content, bio }, expectedRevision: 0 }, 'PUT'),
    ),
  );
  expect(saves.map((response) => response.status).sort()).toEqual([200, 412]);
  const submissions = await Promise.all(
    [0, 1].map(() =>
      creator.http.write(
        ownRoute + '/submissions',
        { expectedDraftRevision: 1, confirmed: true },
        'POST',
        nonce(),
      ),
    ),
  );
  expect(submissions.map((response) => response.status).sort()).toEqual([200, 409]);
  const own = OwnProfileResponseSchema.parse(await (await creator.http.raw(ownRoute)).json()).data,
    pending = own.latestSubmission;
  expect(pending?.status).toBe('PENDING');
  if (!pending) throw new Error('Missing real pending profile');
  expect((await other.http.raw(ownRoute + '/submissions/' + pending.id)).status).toBe(404);
  const reviews = await Promise.all(
    [0, 1].map(() =>
      admin.http.write(
        '/api/v1/admin/profiles/submissions/' + pending.id + '/review',
        {
          decision: 'approve',
          expectedRevision: 1,
          reason: '隔离并发审核',
          selfReviewConfirmed: false,
        },
        'POST',
        nonce(),
      ),
    ),
  );
  expect(reviews.map((response) => response.status).sort()).toEqual([200, 409]);
  expect(
    OwnProfileResponseSchema.parse(await (await creator.http.raw(ownRoute)).json()).data.published
      ?.id,
  ).toBe(pending.id);
  const records = await stack.owner.pool.query<{ amount: number }>(
    "SELECT count(*)::int AS amount FROM profile_records WHERE submission_id=$1 AND action='approve'",
    [pending.id],
  );
  expect(records.rows[0]?.amount).toBe(1);
});
