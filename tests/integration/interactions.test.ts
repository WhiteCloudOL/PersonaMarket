import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  FavoritesResponseSchema,
  InteractionResponseSchema,
  InteractionSettingsResponseSchema,
  OwnInteractionsResponseSchema,
  PublicReleaseResponseSchema,
  SubmissionResponseSchema,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { completePersona, verifiedCreator } from '../fixtures/creator.js';
import { seedLegacyUnverified } from '../fixtures/legacy-account.js';
import type { AuthHttp } from '../fixtures/auth-http.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});

async function publish(
  owner: AuthHttp,
  admin: AuthHttp,
  platform: 'maibot' | 'astrbot' = 'maibot',
) {
  const persona = await completePersona(owner, platform);
  const response = await owner.write(
    '/api/v1/me/personas/' + persona.id + '/releases',
    {
      version: '1.0.0',
      expectedDraftRevision: persona.revision,
      changelog: '互动权限验收',
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
          expectedRevision: 1,
          reason: '核实互动测试作品',
          selfReviewConfirmed: false,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  return { ...persona, releaseId: submission.releaseId };
}
async function publicCounts(id: string) {
  const response = await stack.browser().raw('/api/v1/personas/' + id);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  return PublicReleaseResponseSchema.parse(await response.json()).data.interactionCounts;
}
async function fixture() {
  const author = await verifiedCreator(stack);
  const viewer = await verifiedCreator(stack);
  const admin = await stack.admin();
  const persona = await publish(author.http, admin.http);
  return { author, viewer, admin, persona, path: '/api/v1/personas/' + persona.id };
}
async function favorites(http: AuthHttp, query = '') {
  const response = await http.raw('/api/v1/me/favorites' + query);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  return FavoritesResponseSchema.parse(await response.json());
}

it('并发PUT/DELETE幂等、两关系唯一、精确计数、取消重加保留首次时间且Release更新不清空', async () => {
  const { author, viewer, admin, persona, path } = await fixture();
  for (const kind of ['like', 'favorite']) {
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => viewer.http.write(path + '/' + kind, {}, 'PUT')),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
    for (const response of responses) InteractionResponseSchema.parse(await response.json());
  }
  expect(await publicCounts(persona.id)).toEqual({ likes: 1, favorites: 1 });
  const first = await stack.owner.pool.query<{ first_added_at: Date }>(
    'SELECT first_added_at FROM persona_favorites WHERE persona_id=$1',
    [persona.id],
  );
  await expect(
    stack.owner.pool.query(
      'INSERT INTO persona_favorites(user_id,persona_id) SELECT user_id,persona_id FROM persona_favorites WHERE persona_id=$1',
      [persona.id],
    ),
  ).rejects.toMatchObject({ code: '23505' });
  for (const kind of ['like', 'favorite']) {
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => viewer.http.write(path + '/' + kind, undefined, 'DELETE')),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
  }
  expect(await publicCounts(persona.id)).toEqual({ likes: 0, favorites: 0 });
  expect((await favorites(viewer.http)).meta.total).toBe(0);
  for (const kind of ['like', 'favorite'])
    expect((await viewer.http.write(path + '/' + kind, {}, 'PUT')).status).toBe(200);
  const after = await stack.owner.pool.query<{ first_added_at: Date }>(
    'SELECT first_added_at FROM persona_favorites WHERE persona_id=$1',
    [persona.id],
  );
  expect(after.rows[0]?.first_added_at).toEqual(first.rows[0]?.first_added_at);
  const next = await author.http.write(
    '/api/v1/me/personas/' + persona.id + '/releases',
    {
      version: '1.0.1',
      expectedDraftRevision: persona.revision,
      changelog: '保持作品级互动',
      confirmed: true,
    },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  const submission = SubmissionResponseSchema.parse(await next.json()).data;
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/moderation/submissions/' + submission.id + '/review',
        {
          action: 'approve',
          expectedRevision: 1,
          reason: '同作品新版本',
          selfReviewConfirmed: false,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  expect(await publicCounts(persona.id)).toEqual({ likes: 1, favorites: 1 });
  const historical = await stack
    .browser()
    .raw('/api/v1/personas/' + persona.id + '/releases/' + persona.releaseId);
  expect(historical.status).toBe(200);
  expect(PublicReleaseResponseSchema.parse(await historical.json()).data.interactionCounts).toEqual(
    { likes: 1, favorites: 1 },
  );
  const state = OwnInteractionsResponseSchema.parse(
    await (await viewer.http.raw('/api/v1/me/persona-interactions?ids=' + persona.id)).json(),
  );
  expect(state.data).toEqual([
    { personaId: persona.id, liked: true, favorited: true, counts: { likes: 1, favorites: 1 } },
  ]);
  expect((await favorites(author.http)).data).toEqual([]);
});

it('私有收藏分页排序筛选、隐藏后只返回不可用占位，禁止猜测ID删除但本人仍可移除', async () => {
  const { author, viewer, admin, persona, path } = await fixture();
  const astr = await publish(author.http, admin.http, 'astrbot');
  const other = await verifiedCreator(stack);
  for (const id of [persona.id, astr.id])
    expect(
      (await viewer.http.write('/api/v1/personas/' + id + '/favorite', {}, 'PUT')).status,
    ).toBe(200);
  const first = await favorites(viewer.http, '?pageSize=1&sort=oldest');
  expect(first.meta.total).toBe(2);
  expect(first.data.map((row) => row.personaId)).toEqual([persona.id]);
  expect(
    (await favorites(viewer.http, '?pageSize=1&page=2&sort=oldest')).data.map(
      (row) => row.personaId,
    ),
  ).toEqual([astr.id]);
  expect(
    (await favorites(viewer.http, '?platform=astrbot')).data.map((row) => row.personaId),
  ).toEqual([astr.id]);
  for (const sort of ['title', 'updated'])
    expect((await favorites(viewer.http, '?sort=' + sort)).data).toHaveLength(2);
  expect(
    (
      await author.http.write('/api/v1/me/personas/' + persona.id + '/visibility', {
        visibility: 'hidden',
        reason: '验证收藏访问边界',
      })
    ).status,
  ).toBe(200);
  const hidden = await favorites(viewer.http, '?availability=unavailable');
  expect(hidden.data).toEqual([
    { available: false, personaId: persona.id, savedAt: expect.any(String) },
  ]);
  expect(JSON.stringify(hidden)).not.toContain('真实发布作品');
  expect(JSON.stringify(hidden)).not.toContain('releaseId');
  const batch = OwnInteractionsResponseSchema.parse(
    await (
      await viewer.http.raw('/api/v1/me/persona-interactions?ids=' + persona.id + ',' + astr.id)
    ).json(),
  );
  expect(batch.data.map((row) => row.personaId)).toEqual([astr.id]);
  expect(
    (await favorites(viewer.http, '?q=' + encodeURIComponent('真实发布'))).data.map(
      (row) => row.personaId,
    ),
  ).toEqual([astr.id]);
  expect((await other.http.write(path + '/favorite', {}, 'DELETE')).status).toBe(404);
  expect((await viewer.http.write(path + '/like', {}, 'PUT')).status).toBe(404);
  const removed = await viewer.http.write(path + '/favorite', {}, 'DELETE');
  expect(removed.status).toBe(200);
  expect(InteractionResponseSchema.parse(await removed.json()).data).toEqual({
    personaId: persona.id,
    available: false,
    favorited: false,
  });
  expect((await favorites(viewer.http)).data.map((row) => row.personaId)).toEqual([astr.id]);
  expect((await stack.browser().raw('/api/v1/me/favorites')).status).toBe(401);
  expect(
    (
      await other.http.raw(
        '/api/v1/me/favorites?userId=' + (await viewer.http.context()).data.account?.id,
      )
    ).status,
  ).toBe(400);
});

it('邮箱、CSRF、账号与资源权限由服务端复查，批量读取不返回不可公开状态', async () => {
  const { viewer, persona, path } = await fixture();
  const guest = stack.browser();
  expect((await guest.write(path + '/like', {}, 'PUT')).status).toBe(401);
  expect((await viewer.http.raw('/api/v1/me/favorites?q=%00')).status).toBe(400);
  const unverified = stack.browser();
  const username = 'unverified_' + randomUUID().replaceAll('-', '').slice(0, 10);
  const password = 'Unverified fixture passphrase 2026';
  await seedLegacyUnverified(stack.owner, {
    username,
    email: username + '@fixture.invalid',
    password,
  });
  expect(
    (await unverified.write('/api/v1/auth/login', { identifier: username, password })).status,
  ).toBe(200);
  expect((await unverified.write(path + '/favorite', {}, 'PUT')).status).toBe(403);
  expect((await viewer.http.raw(path + '/like', { method: 'PUT', body: '{}' })).status).toBe(403);
  expect((await viewer.http.write(path + '/like', { role: 'admin' }, 'PUT')).status).toBe(400);
  expect(
    (await viewer.http.write('/api/v1/personas/' + randomUUID() + '/like', {}, 'PUT')).status,
  ).toBe(404);
  expect(
    (
      await viewer.http.raw(
        '/api/v1/me/persona-interactions?ids=' +
          Array.from({ length: 51 }, () => randomUUID()).join(','),
      )
    ).status,
  ).toBe(400);
  expect((await viewer.http.write(path + '/like', {}, 'PUT')).status).toBe(200);
  const id = (await viewer.http.context()).data.account?.id;
  await stack.owner.pool.query(
    "UPDATE users SET status='banned',security_version=security_version+1 WHERE id=$1",
    [id],
  );
  expect((await viewer.http.write(path + '/favorite', {}, 'PUT')).status).toBe(401);
  expect(await publicCounts(persona.id)).toEqual({ likes: 0, favorites: 0 });
});

it('社区开关ETag冲突和审计真实生效，正常管理员业务配置不要求新的近期MFA，关闭仍能取消', async () => {
  const { viewer, admin, path } = await fixture();
  expect((await viewer.http.write(path + '/favorite', {}, 'PUT')).status).toBe(200);
  const current = await admin.http.raw('/api/v1/admin/settings/community');
  expect(current.status).toBe(200);
  const etag = current.headers.get('etag');
  const previous = InteractionSettingsResponseSchema.parse(await current.json());
  expect(previous.data).toEqual({
    likesEnabled: true,
    favoritesEnabled: true,
    commentsEnabled: true,
    showExistingComments: true,
    commentReviewMode: 'all',
    commentMaxLength: 2000,
    commentsPerMinute: 5,
  });
  const adminId = (await admin.http.context()).data.account?.id;
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET mfa_verified_at=now()-interval '11 minutes' WHERE user_id=$1",
    [adminId],
  );
  const body = { ...previous.data, likesEnabled: false, favoritesEnabled: false };
  expect(
    (
      await admin.http.write('/api/v1/admin/settings/community', body, 'PATCH', {
        'If-Match': etag ?? '',
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await admin.http.write('/api/v1/admin/settings/community', body, 'PATCH', {
        'If-Match': etag ?? '',
      })
    ).status,
  ).toBe(412);
  expect((await viewer.http.raw('/api/v1/admin/settings/community')).status).toBe(403);
  expect((await viewer.http.write(path + '/like', {}, 'PUT')).status).toBe(403);
  expect((await viewer.http.write(path + '/favorite', {}, 'PUT')).status).toBe(403);
  expect((await viewer.http.write(path + '/favorite', {}, 'DELETE')).status).toBe(200);
  const audit = await stack.owner.pool.query(
    "SELECT count(*)::int AS total FROM auth_audit_events WHERE event='admin.community_settings_updated' AND user_id=$1",
    [adminId],
  );
  expect(audit.rows).toEqual([{ total: 1 }]);
});

it('实际事务等待期间被封禁或隐藏不能沿用旧身份和旧公开状态完成写入', async () => {
  const { author, viewer, persona, path } = await fixture();
  const actorId = (await viewer.http.context()).data.account?.id;
  const blocker = await stack.owner.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM personas WHERE id=$1 FOR UPDATE', [persona.id]);
    pending = viewer.http.write(path + '/like', {}, 'PUT');
    await expect
      .poll(async () =>
        Number(
          (
            await stack.owner.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND application_name='personamarket'",
            )
          ).rows[0]?.count,
        ),
      )
      .toBeGreaterThan(0);
    await blocker.query("UPDATE personas SET owner_visibility='hidden' WHERE id=$1", [persona.id]);
    await blocker.query('COMMIT');
    expect((await pending).status).toBe(404);
    expect(
      (
        await author.http.write('/api/v1/me/personas/' + persona.id + '/visibility', {
          visibility: 'listed',
          reason: '继续身份竞态核验',
        })
      ).status,
    ).toBe(200);
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [actorId]);
    pending = viewer.http.write(path + '/favorite', {}, 'PUT');
    await expect
      .poll(async () =>
        Number(
          (
            await stack.owner.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND application_name='personamarket'",
            )
          ).rows[0]?.count,
        ),
      )
      .toBeGreaterThan(0);
    await blocker.query(
      "UPDATE users SET status='banned',security_version=security_version+1 WHERE id=$1",
      [actorId],
    );
    await blocker.query('COMMIT');
    expect((await pending).status).toBe(401);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await pending;
  }
  expect(
    (
      await stack.owner.pool.query(
        'SELECT count(*)::int AS total FROM persona_likes WHERE persona_id=$1',
        [persona.id],
      )
    ).rows,
  ).toEqual([{ total: 0 }]);
  expect(
    (
      await stack.owner.pool.query(
        'SELECT count(*)::int AS total FROM persona_favorites WHERE persona_id=$1',
        [persona.id],
      )
    ).rows,
  ).toEqual([{ total: 0 }]);
});

it('真实Redis账号限流返回429与重试时间，幂等重试不会重复计数', async () => {
  const { viewer, persona, path } = await fixture();
  for (let index = 0; index < 30; index++)
    expect((await viewer.http.write(path + '/like', {}, 'PUT')).status).toBe(200);
  const limited = await viewer.http.write(path + '/like', {}, 'PUT');
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  expect(await publicCounts(persona.id)).toEqual({ likes: 1, favorites: 0 });
});

it('等待社区设置事务期间关闭新增后直接API被拒绝，不使用事务外旧开关', async () => {
  const { viewer, persona, path } = await fixture();
  const blocker = await stack.owner.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query("SELECT key FROM site_settings WHERE key='community' FOR UPDATE");
    pending = viewer.http.write(path + '/like', {}, 'PUT');
    await expect
      .poll(async () =>
        Number(
          (
            await stack.owner.pool.query<{ count: string }>(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND application_name='personamarket'",
            )
          ).rows[0]?.count,
        ),
      )
      .toBeGreaterThan(0);
    await blocker.query(
      "UPDATE site_settings SET value=jsonb_set(value,'{likesEnabled}','false'::jsonb),revision=revision+1 WHERE key='community'",
    );
    await blocker.query('COMMIT');
    expect((await pending).status).toBe(403);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await pending;
  }
  expect(await publicCounts(persona.id)).toEqual({ likes: 0, favorites: 0 });
  expect(
    (
      await stack.owner.pool.query<{ total: number }>(
        'SELECT count(*)::integer AS total FROM persona_likes WHERE persona_id=$1',
        [persona.id],
      )
    ).rows,
  ).toEqual([{ total: 0 }]);
});

it('收藏读取超时返回可重试的503，不泄漏SQL或返回内部错误', async () => {
  const { viewer, path } = await fixture();
  expect((await viewer.http.write(path + '/favorite', {}, 'PUT')).status).toBe(200);
  const blocker = await stack.owner.pool.connect();
  try {
    await blocker.query('BEGIN');
    await blocker.query('LOCK TABLE persona_likes IN ACCESS EXCLUSIVE MODE');
    const response = await viewer.http.raw('/api/v1/me/favorites');
    expect(response.status).toBe(503);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    const payload = await response.text();
    expect(payload).toContain('SERVICE_UNAVAILABLE');
    expect(payload).not.toContain('SELECT');
    expect(payload).not.toContain('persona_likes');
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
});
