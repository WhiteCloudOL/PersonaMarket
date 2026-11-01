import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  AdminPersonaResponseSchema,
  PublicPersonaListResponseSchema,
  SubmissionResponseSchema,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { completePersona, verifiedCreator } from '../fixtures/creator.js';
import type { AuthHttp } from '../fixtures/auth-http.js';
import { createAdministrator } from '@personamarket/server';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});

async function current(http: AuthHttp, id: string) {
  const response = await http.raw('/api/v1/admin/personas/' + id);
  expect(response.status).toBe(200);
  return AdminPersonaResponseSchema.parse(await response.json()).data;
}

async function publish(owner: AuthHttp, reviewer: AuthHttp) {
  const created = await completePersona(owner);
  const response = await owner.write(
    '/api/v1/me/personas/' + created.id + '/releases',
    {
      version: '1.0.0',
      changelog: '可审核的首版',
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
      await reviewer.write(
        '/api/v1/admin/moderation/submissions/' + submission.id + '/review',
        {
          action: 'approve',
          expectedRevision: submission.revision,
          reason: '检查实际公开内容',
          selfReviewConfirmed: false,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  return created;
}

async function curate(http: AuthHttp, id: string, official: boolean, featured: boolean) {
  const row = await current(http, id);
  return http.write(
    '/api/v1/admin/personas/' + id + '/curation',
    {
      official,
      featured,
      expectedRevision: row.revision,
      reason: '核对运营标记',
    },
    'PUT',
    { 'Idempotency-Key': randomUUID() },
  );
}

it('管理员策展采用真实公开资格和修订号，幂等重试保留不可变版本并即时更新公开标记', async () => {
  const admin = await stack.admin();
  const owner = await verifiedCreator(stack);
  const created = await completePersona(owner.http);
  const path = '/api/v1/admin/personas/' + created.id;
  async function current() {
    const response = await admin.http.raw(path);
    expect(response.status).toBe(200);
    return AdminPersonaResponseSchema.parse(await response.json()).data;
  }
  const unpublished = await current();
  const beforePublication = await admin.http.write(
    path + '/curation',
    {
      official: true,
      featured: true,
      reason: '核对公开资格',
      expectedRevision: unpublished.revision,
    },
    'PUT',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(beforePublication.status).toBe(409);
  const submissionResponse = await owner.http.write(
    '/api/v1/me/personas/' + created.id + '/releases',
    { version: '1.0.0', changelog: '首个公开版本', expectedDraftRevision: 2, confirmed: true },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(submissionResponse.status).toBe(200);
  const submission = SubmissionResponseSchema.parse(await submissionResponse.json()).data;
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/moderation/submissions/' + submission.id + '/review',
        {
          action: 'approve',
          expectedRevision: submission.revision,
          reason: '核对作品',
          selfReviewConfirmed: false,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  const immutable = await stack.owner.pool.query(
    'SELECT snapshot,publication FROM release_submissions WHERE id=$1',
    [submission.id],
  );
  const initial = await current();
  const input = {
    official: true,
    featured: true,
    reason: '核对来源后推荐',
    expectedRevision: initial.revision,
  };
  const key = randomUUID();
  expect(
    (await owner.http.write(path + '/curation', input, 'PUT', { 'Idempotency-Key': key })).status,
  ).toBe(403);
  const apply = () =>
    admin.http.write(path + '/curation', input, 'PUT', { 'Idempotency-Key': key });
  expect((await apply()).status).toBe(200);
  expect((await apply()).status).toBe(200);
  expect(await current()).toMatchObject({
    revision: initial.revision + 1,
    curation: { official: true, featured: true },
  });
  const publicResponse = await owner.http.raw(
    '/api/v1/personas?q=' + encodeURIComponent(created.draft.title),
  );
  expect(publicResponse.status).toBe(200);
  expect(
    PublicPersonaListResponseSchema.parse(await publicResponse.json()).data.find(
      (row) => row.personaId === created.id,
    ),
  ).toMatchObject({ curation: { official: true, featured: true } });
  expect(
    (
      await admin.http.write(path + '/curation', { ...input, official: false }, 'PUT', {
        'Idempotency-Key': key,
      })
    ).status,
  ).toBe(409);
  expect(
    (await admin.http.write(path + '/curation', input, 'PUT', { 'Idempotency-Key': randomUUID() }))
      .status,
  ).toBe(412);
  expect(
    (
      await stack.owner.pool.query(
        'SELECT snapshot,publication FROM release_submissions WHERE id=$1',
        [submission.id],
      )
    ).rows,
  ).toEqual(immutable.rows);
  expect(
    (
      await stack.owner.pool.query(
        "SELECT count(*)::int AS count FROM moderation_records WHERE persona_id=$1 AND action='persona_curated'",
        [created.id],
      )
    ).rows[0]?.count,
  ).toBe(1);
});

it('隐藏和下架作品不能新增标记，可以解除既有标记，公开读取继续受限', async () => {
  const admin = await stack.admin();
  const owner = await verifiedCreator(stack);
  const created = await publish(owner.http, admin.http);
  expect((await curate(admin.http, created.id, true, true)).status).toBe(200);
  const detail = await owner.http.raw('/api/v1/personas/' + created.id);
  expect(detail.status).toBe(200);
  expect(await detail.json()).toMatchObject({
    data: { curation: { official: true, featured: true } },
  });
  const account = (await owner.http.context()).data.account;
  if (!account) throw new Error('作者未登录');
  const owned = await admin.http.raw('/api/v1/admin/users/' + account.id + '/public-personas');
  expect(owned.status).toBe(200);
  expect(await owned.json()).toMatchObject({
    data: [{ personaId: created.id, curation: { official: true, featured: true } }],
  });
  for (const flag of ['official', 'featured']) {
    const response = await admin.http.raw('/api/v1/admin/personas?' + flag + '=true');
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject([{ id: created.id }]);
  }
  expect(
    (
      await owner.http.write('/api/v1/me/personas/' + created.id + '/visibility', {
        visibility: 'hidden',
        reason: '作者主动隐藏',
      })
    ).status,
  ).toBe(200);
  expect((await owner.http.raw('/api/v1/personas/' + created.id)).status).toBe(404);
  expect((await curate(admin.http, created.id, false, true)).status).toBe(200);
  expect((await curate(admin.http, created.id, true, true)).status).toBe(409);
  expect((await curate(admin.http, created.id, false, false)).status).toBe(200);
  const row = await current(admin.http, created.id);
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/personas/' + created.id + '/moderation',
        {
          state: 'blocked',
          expectedRevision: row.revision,
          reason: '核对下架后的公开资格',
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  expect((await curate(admin.http, created.id, false, true)).status).toBe(409);
  expect(await current(admin.http, created.id)).toMatchObject({
    ownerVisibility: 'hidden',
    moderationState: 'blocked',
    curation: { official: false, featured: false },
  });
});

it('并发策展只有一个修订提交，胜出请求重试不重复审计', async () => {
  const admin = await stack.admin();
  const owner = await verifiedCreator(stack);
  const created = await publish(owner.http, admin.http);
  const row = await current(admin.http, created.id);
  const command = {
    official: true,
    featured: false,
    expectedRevision: row.revision,
    reason: '并发核对',
  };
  const keys = [randomUUID(), randomUUID()];
  const write = (key: string) =>
    admin.http.write('/api/v1/admin/personas/' + created.id + '/curation', command, 'PUT', {
      'Idempotency-Key': key,
    });
  const responses = await Promise.all(keys.map(write));
  expect(responses.map((response) => response.status).sort()).toEqual([200, 412]);
  const winner = keys[responses.findIndex((response) => response.status === 200)];
  if (!winner) throw new Error('没有成功的并发请求');
  expect((await write(winner)).status).toBe(200);
  expect((await current(admin.http, created.id)).revision).toBe(row.revision + 1);
  expect(
    (
      await stack.owner.pool.query(
        "SELECT count(*)::int AS count FROM moderation_records WHERE persona_id=$1 AND action='persona_curated'",
        [created.id],
      )
    ).rows[0]?.count,
  ).toBe(1);
});

it.each([false, true])(
  '普通策展不追加近期验证，自审按实际MFA状态要求确认（MFA=%s）',
  async (mfa) => {
    const credentials = {
      username: 'curator_' + randomUUID().slice(0, 8),
      email: 'curator_' + randomUUID() + '@fixture.invalid',
      password: 'A curation fixture passphrase 2026',
    };
    const admin = mfa
      ? await stack.admin()
      : await (async () => {
          await createAdministrator(stack.owner, credentials);
          const http = stack.browser();
          expect(
            (
              await http.write('/api/v1/auth/login', {
                identifier: credentials.username,
                password: credentials.password,
              })
            ).status,
          ).toBe(200);
          return { http, credentials };
        })();
    const reviewer = await stack.admin();
    const owner = await verifiedCreator(stack);
    const other = await publish(owner.http, reviewer.http);
    const own = await publish(admin.http, reviewer.http);
    const actor = (await admin.http.context()).data.account;
    if (!actor) throw new Error('管理员未登录');
    await stack.owner.pool.query(
      "UPDATE auth_sessions SET created_at=now()-interval '20 minutes',mfa_verified_at=now()-interval '20 minutes' WHERE user_id=$1",
      [actor.id],
    );
    expect((await curate(admin.http, other.id, true, false)).status).toBe(200);
    const row = await current(admin.http, own.id);
    const input = {
      official: true,
      featured: true,
      expectedRevision: row.revision,
      reason: '确认本人作品',
      selfReviewConfirmed: false,
    };
    const path = '/api/v1/admin/personas/' + own.id + '/curation';
    const key = randomUUID();
    expect((await admin.http.write(path, input, 'PUT', { 'Idempotency-Key': key })).status).toBe(
      403,
    );
    const confirmed = { ...input, selfReviewConfirmed: true };
    const challenged = await admin.http.write(path, confirmed, 'PUT', { 'Idempotency-Key': key });
    expect(challenged.status).toBe(403);
    expect(await challenged.json()).toMatchObject({
      error: { code: mfa ? 'MFA_REQUIRED' : 'REAUTH_REQUIRED' },
    });
    const verification = await admin.http.write('/api/v1/auth/reauthenticate', {
      currentPassword: admin.credentials.password,
    });
    if (mfa) {
      expect(verification.status).toBe(403);
      expect(await verification.json()).toMatchObject({ error: { code: 'MFA_REQUIRED' } });
      expect((await current(admin.http, own.id)).curation).toEqual({
        official: false,
        featured: false,
      });
    } else {
      expect(verification.status).toBe(200);
      expect(
        (await admin.http.write(path, confirmed, 'PUT', { 'Idempotency-Key': key })).status,
      ).toBe(200);
      expect((await current(admin.http, own.id)).curation).toEqual({
        official: true,
        featured: true,
      });
      expect((await admin.http.context()).data.mfaEnabled).toBe(false);
    }
  },
);
