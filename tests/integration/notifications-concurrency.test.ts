import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CommentResponseSchema, SubmissionResponseSchema } from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { completePersona, verifiedCreator } from '../fixtures/creator.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});
const nonce = () => ({ 'Idempotency-Key': randomUUID() });

it('审核投递与同一作者的新评论并发时，两次真实请求均提交且仅保存一条审核通知', async () => {
  const owner = await verifiedCreator(stack),
    writer = await verifiedCreator(stack),
    admin = await stack.admin();
  const persona = await completePersona(owner.http);
  const submitted = await owner.http.write(
    '/api/v1/me/personas/' + persona.id + '/releases',
    {
      version: '1.0.0',
      expectedDraftRevision: persona.revision,
      changelog: '并发通知测试',
      confirmed: true,
    },
    'POST',
    nonce(),
  );
  expect(submitted.status).toBe(200);
  const submission = SubmissionResponseSchema.parse(await submitted.json()).data;
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/moderation/submissions/' + submission.id + '/review',
        {
          action: 'approve',
          reason: '',
          expectedRevision: submission.revision,
          selfReviewConfirmed: false,
        },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(200);
  const commentsPath = '/api/v1/personas/' + persona.id + '/comments';
  const created = await writer.http.write(
    commentsPath,
    { body: '等待审核的并发原文' },
    'POST',
    nonce(),
  );
  expect(created.status).toBe(200);
  const comment = CommentResponseSchema.parse(await created.json()).data;
  const blocker = await stack.owner.pool.connect();
  const pending: Promise<Response>[] = [];
  let responses: Response[];
  async function waiters() {
    const result = await stack.owner.pool.query<{ amount: number }>(
      "SELECT count(*)::int AS amount FROM pg_stat_activity WHERE datname=current_database() AND application_name='personamarket' AND wait_event_type='Lock' AND query ILIKE '%personas%'",
    );
    return result.rows[0]?.amount ?? 0;
  }
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM personas WHERE id=$1 FOR UPDATE', [persona.id]);
    // 审核先等待作品；作者后等待同一作品，同时持有本人身份锁
    pending.push(
      admin.http.write(
        '/api/v1/admin/comments/' + comment.id + '/review',
        {
          revisionId: comment.latest.id,
          expectedRevision: comment.revision,
          decision: 'approve',
          reason: '',
          selfReviewConfirmed: false,
        },
        'POST',
        nonce(),
      ),
    );
    await expect.poll(waiters, { timeout: 2000, interval: 25 }).toBe(1);
    pending.push(
      writer.http.write(commentsPath, { body: '并发期间提交的另一条评论' }, 'POST', nonce()),
    );
    await expect.poll(waiters, { timeout: 2000, interval: 25 }).toBe(2);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    responses = await Promise.all(pending);
  }
  expect(responses.map((response) => response.status)).toEqual([200, 200]);
  const records = await stack.owner.pool.query<{ amount: number }>(
    "SELECT count(*)::int AS amount FROM notifications WHERE kind='comment_approved' AND source_id=$1",
    [comment.latest.id],
  );
  expect(records.rows[0]?.amount).toBe(1);
  expect(
    (await stack.owner.pool.query('SELECT id FROM comments WHERE persona_id=$1', [persona.id]))
      .rowCount,
  ).toBe(2);
});
