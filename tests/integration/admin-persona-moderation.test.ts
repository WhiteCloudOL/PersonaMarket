import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { AdminPersonaResponseSchema, DraftResponseSchema } from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { completePersona, verifiedCreator } from '../fixtures/creator.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});

it('下架恢复必须有修订号和幂等键，重试不重复记录，冲突不覆盖且保留作者隐藏与草稿', async () => {
  const admin = await stack.admin();
  const owner = await verifiedCreator(stack);
  const created = await completePersona(owner.http);
  expect(
    (
      await owner.http.write('/api/v1/me/personas/' + created.id + '/visibility', {
        visibility: 'hidden',
        reason: '作者选择暂不展示',
      })
    ).status,
  ).toBe(200);
  const detail = '/api/v1/admin/personas/' + created.id;
  const path = detail + '/moderation';
  async function current() {
    const response = await admin.http.raw(detail);
    expect(response.status).toBe(200);
    return AdminPersonaResponseSchema.parse(await response.json()).data;
  }
  const initial = await current();
  expect((await admin.http.write(path, { state: 'blocked', reason: '缺少并发凭据' })).status).toBe(
    400,
  );
  const input = {
    state: 'blocked',
    reason: '核对当前人设后下架',
    expectedRevision: initial.revision,
  };
  expect((await admin.http.write(path, input)).status).toBe(400);
  const key = randomUUID();
  const apply = () => admin.http.write(path, input, 'POST', { 'Idempotency-Key': key });
  expect((await apply()).status).toBe(200);
  expect((await apply()).status).toBe(200);
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/personas/' + created.id.toUpperCase() + '/moderation',
        input,
        'POST',
        {
          'Idempotency-Key': key,
        },
      )
    ).status,
  ).toBe(200);
  expect(await current()).toMatchObject({
    moderationState: 'blocked',
    revision: initial.revision + 1,
    ownerVisibility: 'hidden',
  });
  expect(
    (
      await admin.http.write(path, { ...input, state: 'normal' }, 'POST', {
        'Idempotency-Key': key,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await admin.http.write(path, { ...input, state: 'normal' }, 'POST', {
        'Idempotency-Key': randomUUID(),
      })
    ).status,
  ).toBe(412);
  const records = await stack.owner.pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM moderation_records WHERE persona_id=$1 AND action='persona_blocked'",
    [created.id],
  );
  expect(records.rows[0]?.count).toBe(1);
  expect(
    (
      await admin.http.write(
        path,
        {
          ...input,
          state: 'normal',
          expectedRevision: initial.revision + 1,
          reason: '核对后解除下架',
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  expect(await current()).toMatchObject({
    moderationState: 'normal',
    revision: initial.revision + 2,
    ownerVisibility: 'hidden',
    publiclyVisible: false,
  });
  const saved = DraftResponseSchema.parse(
    await (await owner.http.raw('/api/v1/me/personas/' + created.id + '/draft')).json(),
  );
  expect(saved.data.draft).toEqual(created.draft);
  expect(saved.meta.revision).toBe(created.revision);
});

it('普通用户、审核员和访客不能处置人设，过期MFA仍可读取但不能写入或借幂等键绕过验证', async () => {
  const admin = await stack.admin();
  const owner = await verifiedCreator(stack);
  const reviewer = await verifiedCreator(stack);
  const reviewerId = (await reviewer.http.context()).data.account?.id;
  if (!reviewerId) throw new Error('审核员测试账号未登录');
  await stack.owner.pool.query("UPDATE users SET role='moderator' WHERE id=$1", [reviewerId]);
  expect(
    (
      await reviewer.http.write('/api/v1/auth/login', {
        identifier: reviewer.username,
        password: reviewer.password,
      })
    ).status,
  ).toBe(200);
  const created = await completePersona(owner.http);
  const path = '/api/v1/admin/personas/' + created.id + '/moderation';
  const input = { state: 'blocked', reason: '需要实际管理权限', expectedRevision: 1 };
  for (const [http, status] of [
    [owner.http, 403],
    [reviewer.http, 403],
    [stack.browser(), 401],
  ] as const)
    expect(
      (await http.write(path, input, 'POST', { 'Idempotency-Key': randomUUID() })).status,
    ).toBe(status);
  expect(
    (
      await admin.http.write(path, input, 'POST', {
        'Idempotency-Key': randomUUID(),
        'X-Expected-Account': randomUUID(),
      })
    ).status,
  ).toBe(409);
  const key = randomUUID();
  expect((await admin.http.write(path, input, 'POST', { 'Idempotency-Key': key })).status).toBe(
    200,
  );
  const actor = (await admin.http.context()).data.account;
  if (!actor) throw new Error('管理员测试账号未登录');
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET created_at=now()-interval '20 minutes',mfa_verified_at=now()-interval '11 minutes' WHERE user_id=$1",
    [actor.id],
  );
  expect((await admin.http.raw('/api/v1/admin/personas/' + created.id)).status).toBe(200);
  const response = await admin.http.write(path, input, 'POST', { 'Idempotency-Key': key });
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: 'MFA_REQUIRED' } });
});

it('两名管理员竞争同一修订号只有一个决定生效，同账号并发重试只追加一次记录', async () => {
  const first = await stack.admin();
  const second = await stack.admin();
  const owner = await verifiedCreator(stack);
  const created = await completePersona(owner.http);
  const path = '/api/v1/admin/personas/' + created.id + '/moderation';
  const input = { state: 'blocked', reason: '冻结当前修订号后处理', expectedRevision: 1 };
  const results = await Promise.all(
    [first, second].map((admin) =>
      admin.http.write(path, input, 'POST', { 'Idempotency-Key': randomUUID() }),
    ),
  );
  expect(results.map((response) => response.status).sort((a, b) => a - b)).toEqual([200, 412]);
  const key = randomUUID();
  const restore = { ...input, state: 'normal', expectedRevision: 2, reason: '核对后恢复' };
  const repeated = await Promise.all(
    [1, 2].map(() => first.http.write(path, restore, 'POST', { 'Idempotency-Key': key })),
  );
  expect(repeated.map((response) => response.status)).toEqual([200, 200]);
  const current = AdminPersonaResponseSchema.parse(
    await (await first.http.raw('/api/v1/admin/personas/' + created.id)).json(),
  ).data;
  expect(current).toMatchObject({ revision: 3, moderationState: 'normal' });
  const records = await stack.owner.pool.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM moderation_records WHERE persona_id=$1',
    [created.id],
  );
  expect(records.rows[0]?.count).toBe(2);
});
