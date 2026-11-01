import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  CommentResponseSchema,
  InteractionSettingsResponseSchema,
  NotificationsResponseSchema,
  SubmissionResponseSchema,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { completePersona, verifiedCreator } from '../fixtures/creator.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});
const key = () => ({ 'Idempotency-Key': randomUUID() });
it('自动审核同样投递，自己回复不自提醒；关闭展示时队列跳过且已送达链接重新受限，退回作品只提醒作者', async () => {
  const author = await verifiedCreator(stack),
    reader = await verifiedCreator(stack),
    admin = await stack.admin();
  const persona = await completePersona(author.http);
  const submit = async (version: string) => {
    const response = await author.http.write(
      '/api/v1/me/personas/' + persona.id + '/releases',
      {
        version,
        expectedDraftRevision: persona.revision,
        changelog: '通知资格核验',
        confirmed: true,
      },
      'POST',
      key(),
    );
    expect(response.status).toBe(200);
    return SubmissionResponseSchema.parse(await response.json()).data;
  };
  const first = await submit('1.0.0');
  const review = async (submission: typeof first, action: 'approve' | 'reject') => {
    expect(
      (
        await admin.http.write(
          '/api/v1/admin/moderation/submissions/' + submission.id + '/review',
          {
            action,
            expectedRevision: submission.revision,
            reason: '真实审核通知核验',
            selfReviewConfirmed: false,
          },
          'POST',
          key(),
        )
      ).status,
    ).toBe(200);
  };
  await review(first, 'approve');
  const policy = async (visible: boolean) => {
    const current = await admin.http.raw('/api/v1/admin/settings/community');
    const input = InteractionSettingsResponseSchema.parse(await current.json()).data;
    expect(
      (
        await admin.http.write(
          '/api/v1/admin/settings/community',
          { ...input, commentReviewMode: 'off', showExistingComments: visible },
          'PATCH',
          { 'If-Match': current.headers.get('etag') ?? '' },
        )
      ).status,
    ).toBe(200);
  };
  const inbox = async () =>
    NotificationsResponseSchema.parse(
      await (await reader.http.raw('/api/v1/me/notifications')).json(),
    ).data;
  const path = '/api/v1/personas/' + persona.id + '/comments';
  await policy(true);
  const root = CommentResponseSchema.parse(
    await (await reader.http.write(path, { body: '自动审核的根楼层' }, 'POST', key())).json(),
  ).data;
  expect(root.latest.status).toBe('APPROVED');
  const self = CommentResponseSchema.parse(
    await (
      await reader.http.write(
        path,
        { body: '自己的回复不提醒自己', parentId: root.id },
        'POST',
        key(),
      )
    ).json(),
  ).data;
  const skipped = CommentResponseSchema.parse(
    await (
      await author.http.write(
        path,
        { body: '投递前隐藏展示的回复', parentId: root.id },
        'POST',
        key(),
      )
    ).json(),
  ).data;
  await policy(false);
  await expect
    .poll(async () => {
      await stack.tick();
      return (
        await stack.owner.pool.query(
          "SELECT status FROM notifications WHERE kind='comment_reply' AND source_id=$1",
          [skipped.id],
        )
      ).rows[0]?.status;
    })
    .toBe('skipped');
  expect((await inbox()).filter((row) => row.kind === 'comment_reply')).toHaveLength(0);
  expect(
    (
      await stack.owner.pool.query(
        "SELECT count(*)::int AS amount FROM notifications WHERE kind='comment_reply' AND source_id=$1",
        [self.id],
      )
    ).rows[0]?.amount,
  ).toBe(0);
  await policy(true);
  const delivered = CommentResponseSchema.parse(
    await (
      await author.http.write(
        path,
        { body: '正常公开的第二条回复', parentId: root.id },
        'POST',
        key(),
      )
    ).json(),
  ).data;
  await expect
    .poll(async () => {
      await stack.tick();
      return (await inbox()).filter((row) => row.kind === 'comment_reply').length;
    })
    .toBe(1);
  expect((await inbox()).find((row) => row.kind === 'comment_reply')?.path).toContain(
    '#comment-' + delivered.id,
  );
  await policy(false);
  expect((await inbox()).find((row) => row.kind === 'comment_reply')).toMatchObject({
    available: false,
    path: null,
  });
  await review(await submit('1.1.0'), 'reject');
  await expect
    .poll(async () => {
      await stack.tick();
      return (
        await stack.owner.pool.query(
          "SELECT count(*)::int AS amount FROM notifications WHERE kind='release_rejected' AND status='delivered'",
        )
      ).rows[0]?.amount;
    })
    .toBe(1);
  expect((await inbox()).filter((row) => row.kind === 'release_rejected')).toHaveLength(0);
});
