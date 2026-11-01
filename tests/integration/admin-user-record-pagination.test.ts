import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, expect, it } from 'vitest';
import {
  AdminUserReviewRecordsResponseSchema,
  BulkReviewCommentsResponseSchema,
  CommentResponseSchema,
  InteractionSettingsResponseSchema,
  SubmissionResponseSchema,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { completePersona, verifiedCreator } from '../fixtures/creator.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
let fixture: Awaited<ReturnType<typeof prepare>>;
async function prepare() {
  const admin = await stack.admin();
  const owner = await verifiedCreator(stack);
  const writer = await verifiedCreator(stack);
  const account = (await writer.http.context()).data.account;
  if (!account) throw new Error('评论作者未登录');
  const persona = await completePersona(owner.http);
  const response = await owner.http.write(
    '/api/v1/me/personas/' + persona.id + '/releases',
    {
      version: '1.0.0',
      expectedDraftRevision: persona.revision,
      changelog: '历史分页真实作品',
      confirmed: true,
    },
    'POST',
    { 'Idempotency-Key': randomUUID() },
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
          reason: '核对历史分页样本',
          selfReviewConfirmed: false,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  const settingsPath = '/api/v1/admin/settings/community';
  const original = await admin.http.raw(settingsPath);
  const settings = InteractionSettingsResponseSchema.parse(await original.json()).data;
  expect(
    (
      await admin.http.write(settingsPath, { ...settings, commentsPerMinute: 30 }, 'PATCH', {
        'If-Match': original.headers.get('etag') ?? '',
      })
    ).status,
  ).toBe(200);
  const comments = [];
  for (let index = 0; index < 21; index++) {
    const created = await writer.http.write(
      '/api/v1/personas/' + persona.id + '/comments',
      { body: '真实审核分页记录 ' + String(index).padStart(2, '0') },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(created.status).toBe(200);
    comments.push(CommentResponseSchema.parse(await created.json()).data);
  }
  for (let index = 0; index < comments.length; index += 20) {
    const chunk = comments.slice(index, index + 20);
    const reviewed = await admin.http.write(
      '/api/v1/admin/comments/bulk-review',
      {
        items: chunk.map((row) => ({
          id: row.id,
          review: {
            decision: 'approve',
            revisionId: row.latest.id,
            expectedRevision: row.revision,
            reason: '完整分页与用户归属',
          },
        })),
      },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(reviewed.status).toBe(200);
    expect(
      BulkReviewCommentsResponseSchema.parse(await reviewed.json()).data.map((row) => row.ok),
    ).toEqual(chunk.map(() => true));
  }
  return {
    admin,
    writer,
    persona,
    comments,
    path: '/api/v1/admin/users/' + account.id + '/review-records',
    settingsPath,
  };
}
beforeEach(async () => {
  stack = await createAuthStack();
  fixture = await prepare();
});
afterEach(async () => {
  await stack?.close();
});

it('21条真实评论审核记录分页无遗漏，空页保留总数，自动通过记录显示真实系统处理人', async () => {
  const { admin, writer, persona, comments, path, settingsPath } = fixture;
  async function read(query: string) {
    const response = await admin.http.raw(path + query);
    expect(response.status).toBe(200);
    return AdminUserReviewRecordsResponseSchema.parse(await response.json());
  }
  const first = await read('?kind=comment');
  const second = await read('?kind=comment&page=2');
  expect(first.data).toHaveLength(20);
  expect(second.data).toHaveLength(1);
  expect(first.meta.total).toBe(21);
  expect(second.meta.total).toBe(21);
  const ids = [...first.data, ...second.data].map((row) =>
    row.kind === 'comment' ? row.commentId : 'unexpected-persona',
  );
  expect(new Set(ids).size).toBe(21);
  expect(new Set(ids)).toEqual(new Set(comments.map((row) => row.id)));
  expect(await read('?page=3')).toMatchObject({ data: [], meta: { page: 3, total: 21 } });
  const current = await admin.http.raw(settingsPath);
  const settings = InteractionSettingsResponseSchema.parse(await current.json()).data;
  expect(
    (
      await admin.http.write(settingsPath, { ...settings, commentReviewMode: 'off' }, 'PATCH', {
        'If-Match': current.headers.get('etag') ?? '',
      })
    ).status,
  ).toBe(200);
  const created = await writer.http.write(
    '/api/v1/personas/' + persona.id + '/comments',
    { body: '依法定业务设置自动通过的真实评论' },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(created.status).toBe(200);
  const comment = CommentResponseSchema.parse(await created.json()).data;
  const latest = await read('?kind=comment');
  expect(latest.meta.total).toBe(22);
  expect(
    latest.data.find((row) => row.kind === 'comment' && row.commentId === comment.id),
  ).toMatchObject({ action: 'auto_approve', actor: null, selfReview: false });
});
