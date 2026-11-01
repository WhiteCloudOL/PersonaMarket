import { moderatePersona } from '../fixtures/admin-persona-moderation.js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  DraftResponseSchema,
  SubmissionResponseSchema,
  PublicReleaseResponseSchema,
  PublicPersonaListResponseSchema,
  type PersonaDraft,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { mailToken, mailText } from '../fixtures/mailpit.js';
let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeAll(async () => {
  stack = await createAuthStack();
});
afterAll(async () => {
  await stack?.close();
});
async function author() {
  const username = 'release_' + randomUUID().replaceAll('-', '').slice(0, 12);
  const email = username + '@fixture.invalid';
  const password = 'A verified creative passphrase 2026';
  const http = stack.browser();
  expect((await http.write('/api/v1/auth/register', { username, email, password })).status).toBe(
    200,
  );
  expect(
    (
      await http.write('/api/v1/auth/verify-email', {
        token: await mailToken(email, 'verify-email', stack.tick),
      })
    ).status,
  ).toBe(200);
  expect((await http.write('/api/v1/auth/login', { identifier: username, password })).status).toBe(
    200,
  );
  return { http, username, email };
}
it('两平台真实投稿审核、不可变快照、并发与幂等、更新隔离和完整上下架权限', async () => {
  const owner = await author();
  const stranger = await author();
  const admin = await stack.admin();
  const admin2 = await stack.admin();
  const visitor = stack.browser();
  const created = await owner.http.write('/api/v1/me/personas', {
    platform: 'maibot',
    title: '林间云鸭',
  });
  const initial = DraftResponseSchema.parse(await created.json());
  const id = initial.data.id;
  const path = '/api/v1/me/personas/' + id;
  const create = (version: string, expected = 2, key = randomUUID()) =>
    owner.http.write(
      path + '/releases',
      {
        version,
        expectedDraftRevision: expected,
        changelog: '本次更新保留完整作者正文',
        confirmed: true,
      },
      'POST',
      { 'Idempotency-Key': key },
    );
  expect((await create('1.0.0', 1)).status).toBe(422);
  const draft: PersonaDraft = {
    ...initial.data.draft,
    title: '林间云鸭',
    summary: '与你分享林间日常',
    rightsAccepted: true,
    readmeMarkdown: '# 作者原文\n\n  保留空白  ',
    content: {
      personality: '温和亲切的向导',
      replyStyle: '简短自然的中文',
      behaviorStyle: '耐心倾听',
    },
    platform: 'maibot',
  };
  expect(
    (await owner.http.write(path + '/draft', draft, 'PUT', { 'If-Match': '"draft-1"' })).status,
  ).toBe(200);
  const key = randomUUID();
  const submissionResponse = await create('1.0.0', 2, key);
  expect(submissionResponse.status).toBe(200);
  const submission = SubmissionResponseSchema.parse(await submissionResponse.json()).data;
  expect(submission.status).toBe('PENDING');
  expect(SubmissionResponseSchema.parse(await (await create('1.0.0', 2, key)).json()).data.id).toBe(
    submission.id,
  );
  expect((await create('1.0.1', 2, key)).status).toBe(409);
  expect((await create('1.0.1')).status).toBe(409);
  expect((await visitor.raw('/api/v1/personas/' + id)).status).toBe(404);
  expect(
    (await visitor.raw('/api/v1/personas/' + id + '/releases/' + submission.releaseId)).status,
  ).toBe(404);
  expect((await stranger.http.raw(path + '/releases')).status).toBe(404);
  expect((await owner.http.raw('/api/v1/admin/moderation/submissions')).status).toBe(403);
  await expect(
    stack.owner.pool.query(
      'UPDATE release_submissions SET snapshot = snapshot || \'{"title":"篡改"}\'::jsonb WHERE id=$1',
      [submission.id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  const next = { ...draft, title: '未经审核的新标题' };
  expect(
    (await owner.http.write(path + '/draft', next, 'PUT', { 'If-Match': '"draft-2"' })).status,
  ).toBe(200);
  const review = (
    http: typeof owner.http,
    action: 'approve' | 'reject',
    target = submission.id,
    revision = 1,
    operationKey = randomUUID(),
  ) =>
    http.write(
      '/api/v1/admin/moderation/submissions/' + target + '/review',
      {
        action,
        expectedRevision: revision,
        reason: '已核验内容与来源许可',
        selfReviewConfirmed: false,
      },
      'POST',
      { 'Idempotency-Key': operationKey },
    );
  const results = await Promise.all([
    review(admin.http, 'approve'),
    review(admin2.http, 'approve'),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  const live = PublicReleaseResponseSchema.parse(
    await (await visitor.raw('/api/v1/personas/' + id)).json(),
  ).data;
  expect(live.snapshot.title).toBe('林间云鸭');
  expect(
    PublicPersonaListResponseSchema.parse(
      await (await visitor.raw('/api/v1/personas?q=' + encodeURIComponent('未经审核'))).json(),
    ).meta.total,
  ).toBe(0);
  expect(live.snapshot.readmeMarkdown).toBe(draft.readmeMarkdown);
  expect(live.snapshot).not.toHaveProperty('evidenceAssetIds');
  expect(live.snapshot).not.toHaveProperty('rightsAccepted');
  expect(await mailText(owner.email, '已审核通过', stack.tick)).toContain('1.0.0');
  const update = SubmissionResponseSchema.parse(await (await create('1.0.2', 3)).json()).data;
  expect(
    PublicReleaseResponseSchema.parse(await (await visitor.raw('/api/v1/personas/' + id)).json())
      .data.releaseId,
  ).toBe(submission.releaseId);
  expect((await review(admin.http, 'reject', update.id)).status).toBe(200);
  const retry = SubmissionResponseSchema.parse(await (await create('1.0.2', 3)).json()).data;
  expect(retry.releaseId).toBe(update.releaseId);
  expect(retry.attemptNumber).toBe(2);
  const reviewKey = randomUUID();
  expect((await review(admin.http, 'approve', retry.id, 1, reviewKey)).status).toBe(200);
  expect((await review(admin.http, 'approve', retry.id, 1, reviewKey)).status).toBe(200);
  expect((await create('1.0.1', 3)).status).toBe(409);
  expect(
    (await stranger.http.write(path + '/visibility', { visibility: 'hidden', reason: '伪造操作' }))
      .status,
  ).toBe(404);
  expect(
    (await owner.http.write(path + '/visibility', { visibility: 'hidden', reason: '作者暂时隐藏' }))
      .status,
  ).toBe(200);
  expect(
    (await visitor.raw('/api/v1/personas/' + id + '/releases/' + submission.releaseId)).status,
  ).toBe(404);
  expect(
    (
      await moderatePersona(admin.http, id, {
        state: 'blocked',
        reason: '管理员处置',
      })
    ).status,
  ).toBe(200);
  expect(
    (await owner.http.write(path + '/visibility', { visibility: 'listed', reason: '作者恢复展示' }))
      .status,
  ).toBe(200);
  expect((await visitor.raw('/api/v1/personas/' + id)).status).toBe(404);
  expect(
    (
      await moderatePersona(admin.http, id, {
        state: 'normal',
        reason: '完成复核',
      })
    ).status,
  ).toBe(200);
  expect((await visitor.raw('/api/v1/personas/' + id)).status).toBe(200);
  expect(
    (
      await owner.http.write(path + '/rollback', {
        releaseId: submission.releaseId,
        reason: '恢复稳定版本',
      })
    ).status,
  ).toBe(200);
  expect(
    PublicReleaseResponseSchema.parse(await (await visitor.raw('/api/v1/personas/' + id)).json())
      .data.releaseId,
  ).toBe(submission.releaseId);
  expect(
    (
      await owner.http.write(path + '/releases/' + submission.releaseId + '/state', {
        action: 'withdraw',
        reason: '作者撤销此版本',
      })
    ).status,
  ).toBe(200);
  expect((await visitor.raw('/api/v1/personas/' + id)).status).toBe(404);
  expect(
    (await visitor.raw('/api/v1/personas/' + id + '/releases/' + retry.releaseId)).status,
  ).toBe(200);
  expect(
    (
      await owner.http.write(path + '/rollback', {
        releaseId: retry.releaseId,
        reason: '选择可用版本',
      })
    ).status,
  ).toBe(200);
  await expect(
    stack.owner.pool.query('DELETE FROM moderation_records WHERE persona_id=$1', [id]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    stack.owner.pool.query('UPDATE persona_releases SET version=$1 WHERE id=$2', [
      '9.9.9',
      retry.releaseId,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  const astr = DraftResponseSchema.parse(
    await (
      await owner.http.write('/api/v1/me/personas', { platform: 'astrbot', title: '星海旅人' })
    ).json(),
  );
  const astrDraft: PersonaDraft = {
    ...astr.data.draft,
    summary: '讲述星海的故事',
    rightsAccepted: true,
    platform: 'astrbot',
    content: {
      systemPrompt: '  星海故事记录员  ',
      dialoguePairs: [{ id: randomUUID(), user: '你好', assistant: '欢迎来到星海' }],
    },
  };
  expect(
    (
      await owner.http.write('/api/v1/me/personas/' + astr.data.id + '/draft', astrDraft, 'PUT', {
        'If-Match': '"draft-1"',
      })
    ).status,
  ).toBe(200);
  const astrSub = SubmissionResponseSchema.parse(
    await (
      await owner.http.write(
        '/api/v1/me/personas/' + astr.data.id + '/releases',
        { version: '1.0.0', expectedDraftRevision: 2, changelog: '首次发布', confirmed: true },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).json(),
  ).data;
  expect((await review(admin.http, 'approve', astrSub.id)).status).toBe(200);
  expect(
    PublicReleaseResponseSchema.parse(
      await (await visitor.raw('/api/v1/personas/' + astr.data.id)).json(),
    ).data.snapshot.content,
  ).toEqual(astrDraft.content);
  const found = PublicPersonaListResponseSchema.parse(
    await (await visitor.raw('/api/v1/personas?q=' + encodeURIComponent('星海'))).json(),
  );
  expect(found.data.map((item) => item.personaId)).toEqual([astr.data.id]);
  expect(
    PublicPersonaListResponseSchema.parse(
      await (
        await visitor.raw('/api/v1/personas?platform=maibot&q=' + encodeURIComponent('星海'))
      ).json(),
    ).meta.total,
  ).toBe(0);
  expect(
    PublicPersonaListResponseSchema.parse(
      await (await visitor.raw('/api/v1/personas?q=%25')).json(),
    ).meta.total,
  ).toBe(0);
  expect(
    PublicPersonaListResponseSchema.parse(
      await (await visitor.raw('/api/v1/personas?q=' + encodeURIComponent("%' OR 1=1--"))).json(),
    ).meta.total,
  ).toBe(0);
});
