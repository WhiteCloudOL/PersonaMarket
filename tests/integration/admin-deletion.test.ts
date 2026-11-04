import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  AdminPersonaResponseSchema,
  CommentResponseSchema,
  DELETED_AUTHOR_LABEL,
  PublicCommentsResponseSchema,
  PublicReleaseResponseSchema,
  ReviewIndicatorsResponseSchema,
  SubmissionResponseSchema,
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
const headers = () => ({ 'Idempotency-Key': randomUUID() });
const indicatorPath = '/api/v1/admin/overview/review-indicators';

async function submit(owner: AuthHttp) {
  const draft = await completePersona(owner);
  const response = await owner.write(
    `/api/v1/me/personas/${draft.id}/releases`,
    {
      version: '1.0.0',
      expectedDraftRevision: draft.revision,
      confirmed: true,
    },
    'POST',
    headers(),
  );
  expect(response.status).toBe(200);
  return SubmissionResponseSchema.parse(await response.json()).data;
}

async function approve(
  admin: AuthHttp,
  submission: Awaited<ReturnType<typeof submit>>,
  selfReviewConfirmed = false,
) {
  const response = await admin.write(
    `/api/v1/admin/moderation/submissions/${submission.id}/review`,
    {
      action: 'approve',
      expectedRevision: submission.revision,
      reason: '核对测试作品',
      selfReviewConfirmed,
    },
    'POST',
    headers(),
  );
  expect(response.status).toBe(200);
}

it.each(['keep_anonymous', 'remove_content'] as const)(
  '管理员删除账号采用 %s，保留审计并立即阻断旧会话',
  async (mode) => {
    const admin = await stack.admin();
    const author = await verifiedCreator(stack);
    const home = await submit(admin.http);
    await approve(admin.http, home, true);
    const owned = await submit(author.http);
    await approve(admin.http, owned);
    const commentPath = `/api/v1/personas/${home.personaId}/comments`;
    const posted = await author.http.write(
      commentPath,
      { body: '删除账号前已审核的评论' },
      'POST',
      headers(),
    );
    expect(posted.status).toBe(200);
    const comment = CommentResponseSchema.parse(await posted.json()).data;
    if (comment.latest.status === 'PENDING') {
      const reviewed = await admin.http.write(
        `/api/v1/admin/comments/${comment.id}/review`,
        {
          revisionId: comment.latest.id,
          expectedRevision: comment.revision,
          decision: 'approve',
          reason: '',
        },
        'POST',
        headers(),
      );
      expect(reviewed.status).toBe(200);
    }
    const target = (await author.http.context()).data.account;
    if (!target) throw new Error('缺少测试账号');
    const security = await stack.owner.pool.query<{ security_version: number }>(
      'SELECT security_version FROM users WHERE id=$1',
      [target.id],
    );
    const revision = security.rows[0]?.security_version;
    expect(revision).toBeGreaterThan(0);
    const path = `/api/v1/admin/users/${target.id}/delete`;
    const body = { expectedSecurityVersion: revision, username: target.username, mode };
    expect((await author.http.write(path, body, 'POST', headers())).status).toBe(403);
    expect(
      (await admin.http.write(path, { ...body, username: 'wrong_user' }, 'POST', headers())).status,
    ).toBe(412);
    const key = headers();
    expect((await admin.http.write(path, body, 'POST', key)).status).toBe(200);
    expect((await admin.http.write(path, body, 'POST', key)).status).toBe(200);
    expect((await admin.http.raw(`/api/v1/admin/users/${target.id}`)).status).toBe(404);
    expect((await author.http.raw('/api/v1/me/personas')).status).toBe(401);
    expect(
      (
        await stack.owner.pool.query('SELECT id FROM users WHERE username=$1 OR email=$2', [
          author.username,
          author.email,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await stack.owner.pool.query(
          'SELECT id FROM auth_audit_events WHERE user_id=$1 AND event=$2',
          [target.id, 'admin.user.delete.' + mode],
        )
      ).rowCount,
    ).toBe(1);
    const guest = stack.browser();
    const published = await guest.raw(`/api/v1/personas/${owned.personaId}`);
    const comments = PublicCommentsResponseSchema.parse(
      await (await guest.raw(commentPath)).json(),
    );
    if (mode === 'keep_anonymous') {
      expect(
        PublicReleaseResponseSchema.parse(await published.json()).data.publication.publisher,
      ).toBe(DELETED_AUTHOR_LABEL);
      expect(comments.data.find((item) => item.id === comment.id)).toMatchObject({
        status: 'published',
        author: { username: DELETED_AUTHOR_LABEL },
      });
    } else {
      expect(published.status).toBe(404);
      expect(comments.data.find((item) => item.id === comment.id)?.status).not.toBe('published');
    }
  },
);

it('红标跟随真实审核队列，管理员删除人设使所有版本与作者草稿失效', async () => {
  const admin = await stack.admin();
  const author = await verifiedCreator(stack);
  const readIndicators = async () =>
    ReviewIndicatorsResponseSchema.parse(await (await admin.http.raw(indicatorPath)).json()).data;
  expect((await author.http.raw(indicatorPath)).status).toBe(403);
  expect((await readIndicators()).releases).toBe(false);
  const submission = await submit(author.http);
  expect((await readIndicators()).releases).toBe(true);
  await approve(admin.http, submission);
  expect((await readIndicators()).releases).toBe(false);
  const comment = await author.http.write(
    `/api/v1/personas/${submission.personaId}/comments`,
    { body: '随人设删除撤回的待审评论' },
    'POST',
    headers(),
  );
  expect(comment.status).toBe(200);
  expect((await readIndicators()).comments).toBe(true);
  const adminPath = `/api/v1/admin/personas/${submission.personaId}`;
  const detail = AdminPersonaResponseSchema.parse(
    await (await admin.http.raw(adminPath)).json(),
  ).data;
  const key = headers();
  const body = { expectedRevision: detail.revision, confirmed: true };
  expect((await admin.http.write(adminPath + '/delete', body, 'POST', key)).status).toBe(200);
  expect((await admin.http.write(adminPath + '/delete', body, 'POST', key)).status).toBe(200);
  expect((await admin.http.raw(adminPath)).status).toBe(404);
  expect((await readIndicators()).comments).toBe(false);
  expect((await author.http.raw(`/api/v1/me/personas/${submission.personaId}/draft`)).status).toBe(
    404,
  );
  expect(
    (
      await stack
        .browser()
        .raw(`/api/v1/personas/${submission.personaId}/releases/${submission.releaseId}`)
    ).status,
  ).toBe(404);
  expect(
    (
      await stack.owner.pool.query(
        'SELECT id FROM moderation_records WHERE persona_id=$1 AND action=$2',
        [submission.personaId, 'persona_deleted'],
      )
    ).rowCount,
  ).toBe(1);
});
