import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  AdminUserResponseSchema,
  DraftResponseSchema,
  PublicPersonaListResponseSchema,
  SubmissionResponseSchema,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { completePersona, verifiedCreator } from '../fixtures/creator.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
let creator: Awaited<ReturnType<typeof verifiedCreator>>;
let other: Awaited<ReturnType<typeof verifiedCreator>>;
let admin: Awaited<ReturnType<Awaited<ReturnType<typeof createAuthStack>>['admin']>>;
beforeEach(async () => {
  stack = await createAuthStack();
  creator = await verifiedCreator(stack);
  other = await verifiedCreator(stack);
  admin = await stack.admin();
});
afterEach(async () => {
  await stack?.close();
});
const nonce = () => ({ 'Idempotency-Key': randomUUID() });
async function publish(owner: typeof creator, platform: 'maibot' | 'astrbot') {
  const persona = await completePersona(owner.http, platform);
  const response = await owner.http.write(
    '/api/v1/me/personas/' + persona.id + '/releases',
    {
      version: '1.0.0',
      expectedDraftRevision: persona.revision,
      confirmed: true,
      changelog: '公开主页作品验证',
    },
    'POST',
    nonce(),
  );
  expect(response.status).toBe(200);
  const submission = SubmissionResponseSchema.parse(await response.json()).data;
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/moderation/submissions/' + submission.id + '/review',
        {
          action: 'approve',
          expectedRevision: submission.revision,
          reason: '真实审核',
          selfReviewConfirmed: false,
        },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(200);
  return persona;
}

it('创作者作品列表只返回该账号的真实公开版本，筛选分页、待审更新和隐藏均保持资格隔离', async () => {
  const endpoint = '/api/v1/users/' + creator.username + '/personas',
    anonymous = stack.browser();
  const empty = await anonymous.raw(endpoint);
  expect(empty.status).toBe(200);
  expect(PublicPersonaListResponseSchema.parse(await empty.json()).meta.total).toBe(0);
  const maibot = await publish(creator, 'maibot'),
    astrbot = await publish(creator, 'astrbot'),
    otherPublic = await publish(other, 'maibot');
  const privateDraft = await completePersona(creator.http),
    pendingDraft = await completePersona(creator.http);
  expect(
    (
      await creator.http.write(
        '/api/v1/me/personas/' + pendingDraft.id + '/releases',
        {
          version: '1.0.0',
          expectedDraftRevision: pendingDraft.revision,
          confirmed: true,
          changelog: '待审作品不可进入主页',
        },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await creator.http.write(
        '/api/v1/me/profile',
        {
          content: {
            displayName: '待审昵称不应出现在公开作品中',
            bio: '私有资料',
            avatarAssetId: null,
            links: [],
          },
          expectedRevision: 0,
        },
        'PUT',
      )
    ).status,
  ).toBe(200);
  const list = PublicPersonaListResponseSchema.parse(await (await anonymous.raw(endpoint)).json());
  expect(list.meta.total).toBe(2);
  expect(list.data.map((row) => row.personaId).sort()).toEqual([maibot.id, astrbot.id].sort());
  for (const id of [otherPublic.id, privateDraft.id, pendingDraft.id])
    expect(list.data.some((row) => row.personaId === id)).toBe(false);
  expect(JSON.stringify(list)).not.toContain('待审昵称不应出现在公开作品中');
  const filtered = PublicPersonaListResponseSchema.parse(
    await (await anonymous.raw(endpoint + '?platform=maibot')).json(),
  );
  expect(filtered.data.map((row) => row.personaId)).toEqual([maibot.id]);
  const pages = [];
  for (const page of [1, 2])
    pages.push(
      ...PublicPersonaListResponseSchema.parse(
        await (await anonymous.raw(endpoint + '?pageSize=1&page=' + page)).json(),
      ).data.map((row) => row.personaId),
    );
  expect(pages.sort()).toEqual([maibot.id, astrbot.id].sort());
  const draftPath = '/api/v1/me/personas/' + maibot.id + '/draft',
    current = DraftResponseSchema.parse(await (await creator.http.raw(draftPath)).json());
  const saved = await creator.http.write(
    draftPath,
    { ...current.data.draft, title: '未审新版不能公开' },
    'PUT',
    { 'If-Match': '"draft-' + current.meta.revision + '"' },
  );
  expect(saved.status).toBe(200);
  const changed = DraftResponseSchema.parse(await saved.json());
  expect(
    (
      await creator.http.write(
        '/api/v1/me/personas/' + maibot.id + '/releases',
        {
          version: '2.0.0',
          expectedDraftRevision: changed.meta.revision,
          confirmed: true,
          changelog: '新版仍需审核',
        },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(200);
  const unchanged = PublicPersonaListResponseSchema.parse(
    await (await anonymous.raw(endpoint)).json(),
  );
  expect(JSON.stringify(unchanged)).not.toContain('未审新版不能公开');
  expect(unchanged.data.find((row) => row.personaId === maibot.id)?.version).toBe('1.0.0');
  expect(
    (
      await creator.http.write(
        '/api/v1/me/personas/' + maibot.id + '/visibility',
        { visibility: 'hidden', reason: '隐藏后不出现在主页' },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(200);
  expect(
    PublicPersonaListResponseSchema.parse(await (await anonymous.raw(endpoint)).json()).data.map(
      (row) => row.personaId,
    ),
  ).toEqual([astrbot.id]);
  const account = (await creator.http.context()).data.account;
  if (!account) throw new Error('Missing controlled creator');
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/profiles/' + account.id + '/visibility',
        {
          hidden: true,
          expectedRevision: 1,
          reason: '资料隐藏不等于作品下架',
          selfReviewConfirmed: false,
        },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(200);
  expect(
    PublicPersonaListResponseSchema.parse(await (await anonymous.raw(endpoint)).json()).data.map(
      (row) => row.personaId,
    ),
  ).toEqual([astrbot.id]);
  const user = AdminUserResponseSchema.parse(
    await (await admin.http.raw('/api/v1/admin/users/' + account.id)).json(),
  ).data;
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/users/' + account.id + '/status',
        {
          status: 'banned',
          scope: 'account_only',
          expectedSecurityVersion: user.securityVersion,
          reason: '封禁后关闭创作者主页入口',
        },
        'PUT',
        nonce(),
      )
    ).status,
  ).toBe(200);
  expect((await anonymous.raw(endpoint)).status).toBe(404);
});

it('不存在的创作者和非法条件不能退化为全站作品列表', async () => {
  const anonymous = stack.browser(),
    endpoint = '/api/v1/users/' + creator.username + '/personas';
  expect((await anonymous.raw('/api/v1/users/nonexistent_creator/personas')).status).toBe(404);
  for (const query of [
    'ownerId=' + randomUUID(),
    'q=anything',
    'pageSize=21',
    'page=0',
    'platform=other',
    'sort=anything',
  ])
    expect((await anonymous.raw(endpoint + '?' + query)).status).toBe(400);
});
