import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import {
  SubmissionResponseSchema,
  DraftResponseSchema,
  PublicReleaseResponseSchema,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator, completePersona } from '../fixtures/creator.js';
let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeAll(async () => {
  stack = await createAuthStack();
});
afterAll(async () => {
  await stack?.close();
});
it('管理员自审必须近期 MFA/确认/理由，审核员不能自审，批准与撤回只成功一个', async () => {
  const admin = await stack.admin();
  const moderator = await verifiedCreator(stack);
  const author = await verifiedCreator(stack);
  await stack.owner.pool.query("UPDATE users SET role='moderator' WHERE username=$1", [
    moderator.username,
  ]);
  expect((await moderator.http.raw('/api/v1/me/personas')).status).toBe(401);
  expect(
    (
      await moderator.http.write('/api/v1/auth/login', {
        identifier: moderator.username,
        password: moderator.password,
      })
    ).status,
  ).toBe(200);
  const submit = async (http: typeof admin.http, id: string, version = '1.0.0', revision = 2) => {
    const response = await http.write(
      '/api/v1/me/personas/' + id + '/releases',
      { version, expectedDraftRevision: revision, changelog: '真实审核权限验证', confirmed: true },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(response.status).toBe(200);
    return SubmissionResponseSchema.parse(await response.json()).data;
  };
  const review = (
    http: typeof admin.http,
    id: string,
    confirmed = false,
    reason = '认真核验后决定',
  ) =>
    http.write(
      '/api/v1/admin/moderation/submissions/' + id + '/review',
      { action: 'approve', expectedRevision: 1, selfReviewConfirmed: confirmed, reason },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
  const own = await completePersona(admin.http);
  const ownSub = await submit(admin.http, own.id);
  expect((await review(admin.http, ownSub.id)).status).toBe(403);
  expect((await review(admin.http, ownSub.id, true, '')).status).toBe(403);
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET mfa_verified_at=now()-interval '11 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
    [admin.credentials.username],
  );
  expect((await review(admin.http, ownSub.id, true)).status).toBe(403);
  await stack.owner.pool.query(
    'UPDATE auth_sessions SET mfa_verified_at=now() WHERE user_id=(SELECT id FROM users WHERE username=$1)',
    [admin.credentials.username],
  );
  expect((await review(admin.http, ownSub.id, true)).status).toBe(200);
  const record = await stack.owner.pool.query<{ self_review: boolean }>(
    "SELECT self_review FROM moderation_records WHERE submission_id=$1 AND action='approved'",
    [ownSub.id],
  );
  expect(record.rows).toEqual([{ self_review: true }]);
  const modOwn = await completePersona(moderator.http);
  const modSub = await submit(moderator.http, modOwn.id);
  expect((await review(moderator.http, modSub.id, true)).status).toBe(403);
  expect((await moderator.http.raw('/api/v1/admin/settings/creation')).status).toBe(403);
  expect((await review(admin.http, modSub.id)).status).toBe(200);
  const userOwn = await completePersona(author.http);
  const userSub = await submit(author.http, userOwn.id, '1.9.0');
  const race = await Promise.all([
    review(admin.http, userSub.id),
    author.http.write('/api/v1/me/submissions/' + userSub.id + '/withdraw', {
      expectedRevision: 1,
      reason: '作者撤回与批准同时到达',
    }),
  ]);
  expect(race.map((item) => item.status).sort()).toEqual([200, 409]);
  const winner = SubmissionResponseSchema.parse(
    await (
      await (race.find((item) => item.status === 200) ?? Promise.reject(new Error('缺少成功响应')))
    ).json(),
  ).data;
  expect(['APPROVED', 'WITHDRAWN']).toContain(winner.status);
  const pointer = await stack.owner.pool.query<{ published_release_id: string | null }>(
    'SELECT published_release_id FROM personas WHERE id=$1',
    [userOwn.id],
  );
  expect(pointer.rows[0]?.published_release_id).toBe(
    winner.status === 'APPROVED' ? userSub.releaseId : null,
  );
  let previous = userSub;
  if (winner.status === 'WITHDRAWN') {
    previous = await submit(author.http, userOwn.id, '1.9.0');
    expect((await review(admin.http, previous.id)).status).toBe(200);
  }
  const next = await submit(author.http, userOwn.id, '1.10.0');
  expect((await review(admin.http, next.id)).status).toBe(200);
  expect(
    PublicReleaseResponseSchema.parse(
      await (await stack.browser().raw('/api/v1/personas/' + userOwn.id)).json(),
    ).data.version,
  ).toBe('1.10.0');
  expect(
    (
      await author.http.write(
        '/api/v1/me/personas/' + userOwn.id + '/releases',
        {
          version: '1.9.1',
          expectedDraftRevision: 2,
          changelog: '不能回退最高版本',
          confirmed: true,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await author.http.write('/api/v1/me/personas/' + userOwn.id + '/restore-submission', {
        submissionId: previous.id,
        expectedDraftRevision: 1,
        confirmed: true,
      })
    ).status,
  ).toBe(412);
  expect(
    (
      await author.http.write('/api/v1/me/personas/' + userOwn.id + '/restore-submission', {
        submissionId: previous.id,
        expectedDraftRevision: 2,
        confirmed: true,
      })
    ).status,
  ).toBe(200);
  expect(
    DraftResponseSchema.parse(
      await (await author.http.raw('/api/v1/me/personas/' + userOwn.id + '/draft')).json(),
    ).meta.revision,
  ).toBe(3);
});
