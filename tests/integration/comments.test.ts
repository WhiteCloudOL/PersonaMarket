import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  AdminCommentResponseSchema,
  BulkReviewCommentsResponseSchema,
  CommentResponseSchema,
  ErrorResponseSchema,
  InteractionSettingsResponseSchema,
  type InteractionSettingsSchema,
  type OwnCommentSchema,
  OwnCommentsResponseSchema,
  PublicCommentsResponseSchema,
  SubmissionResponseSchema,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { completePersona, verifiedCreator } from '../fixtures/creator.js';
import type { AuthHttp } from '../fixtures/auth-http.js';
import type { z } from 'zod';
import { createAdministrator } from '@personamarket/server';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});

async function publish(owner: AuthHttp, reviewer: AuthHttp) {
  const persona = await completePersona(owner);
  const response = await owner.write(
    '/api/v1/me/personas/' + persona.id + '/releases',
    {
      version: '1.0.0',
      expectedDraftRevision: persona.revision,
      changelog: '评论权限验收',
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
          reason: '核实评论测试作品',
          selfReviewConfirmed: false,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  return { ...persona, releaseId: submission.releaseId };
}

async function fixture() {
  const owner = await verifiedCreator(stack);
  const writer = await verifiedCreator(stack);
  const other = await verifiedCreator(stack);
  const admin = await stack.admin();
  const persona = await publish(owner.http, admin.http);
  return {
    owner,
    writer,
    other,
    admin,
    persona,
    path: '/api/v1/personas/' + persona.id + '/comments',
  };
}
async function create(
  http: AuthHttp,
  path: string,
  body: string,
  extra: Record<string, string> = {},
) {
  const response = await http.write(path, { body, ...extra }, 'POST', {
    'Idempotency-Key': randomUUID(),
  });
  expect(response.status).toBe(200);
  return CommentResponseSchema.parse(await response.json()).data;
}
async function approve(http: AuthHttp, row: z.infer<typeof OwnCommentSchema>) {
  const response = await http.write(
    '/api/v1/admin/comments/' + row.id + '/review',
    {
      revisionId: row.latest.id,
      expectedRevision: row.revision,
      decision: 'approve',
      reason: '',
    },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(response.status).toBe(200);
  return AdminCommentResponseSchema.parse(await response.json()).data;
}
async function publicComments(path: string) {
  const response = await stack.browser().raw(path);
  expect(response.status).toBe(200);
  return PublicCommentsResponseSchema.parse(await response.json());
}
async function policy(http: AuthHttp, patch: Partial<z.infer<typeof InteractionSettingsSchema>>) {
  const path = '/api/v1/admin/settings/community';
  const previous = await http.raw(path);
  expect(previous.status).toBe(200);
  const value = InteractionSettingsResponseSchema.parse(await previous.json());
  const response = await http.write(path, { ...value.data, ...patch }, 'PATCH', {
    'If-Match': previous.headers.get('etag') ?? '',
  });
  expect(response.status).toBe(200);
  return InteractionSettingsResponseSchema.parse(await response.json());
}

it('真实数据库锁超时返回可重试503，失败事务不留评论，同一幂等键释放锁后可重试', async () => {
  const { writer, path, persona } = await fixture();
  const blocker = await stack.owner.pool.connect();
  const body = '数据库锁超时后保留重试机会';
  const key = randomUUID();
  let pending: Promise<Response> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query("SELECT key FROM site_settings WHERE key='community' FOR UPDATE");
    pending = writer.http.write(path, { body }, 'POST', { 'Idempotency-Key': key });
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
    const timedOut = await pending;
    expect(timedOut.status).toBe(503);
    expect(timedOut.headers.get('retry-after')).toBe('1');
    const failure = ErrorResponseSchema.parse(await timedOut.json());
    expect(failure.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(failure.error.message).toBe('评论服务繁忙，请稍后重试');
    expect(JSON.stringify(failure)).not.toMatch(/SELECT|postgres|statement_timeout|57014/);
    expect(
      Number(
        (
          await stack.owner.pool.query<{ count: string }>(
            'SELECT count(*) FROM comments WHERE persona_id=$1',
            [persona.id],
          )
        ).rows[0]?.count,
      ),
    ).toBe(0);
    await blocker.query('ROLLBACK');
    const retried = await writer.http.write(path, { body }, 'POST', { 'Idempotency-Key': key });
    expect(retried.status).toBe(200);
    expect(CommentResponseSchema.parse(await retried.json()).data.latest.body).toBe(body);
    const own = await writer.http.raw('/api/v1/me/comments?personaId=' + persona.id);
    expect(OwnCommentsResponseSchema.parse(await own.json()).data).toHaveLength(1);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await pending;
  }
});

it('评论默认待审且只向本人展示，批准后公开，编辑重审与驳回不替换旧获批文本', async () => {
  const owner = await verifiedCreator(stack);
  const writer = await verifiedCreator(stack);
  const other = await verifiedCreator(stack);
  const admin = await stack.admin();
  const persona = await publish(owner.http, admin.http);
  const path = '/api/v1/personas/' + persona.id + '/comments';
  const body = '  保留空白与换行\n<script>这只是纯文本</script> 😀  ';
  const key = randomUUID();
  const created = await writer.http.write(path, { body, releaseId: persona.releaseId }, 'POST', {
    'Idempotency-Key': key,
  });
  expect(created.status).toBe(200);
  const first = CommentResponseSchema.parse(await created.json()).data;
  expect(first.latest.status).toBe('PENDING');
  expect(first.latest.body).toBe(body);
  expect(
    (
      await writer.http.write(path, { body, releaseId: persona.releaseId }, 'POST', {
        'Idempotency-Key': key,
      })
    ).status,
  ).toBe(200);
  const publicBefore = await stack.browser().raw(path);
  expect(publicBefore.status).toBe(200);
  expect(publicBefore.headers.get('cache-control')).toContain('no-store');
  expect(PublicCommentsResponseSchema.parse(await publicBefore.json()).data).toEqual([]);
  for (const http of [owner.http, other.http]) {
    const response = await http.raw('/api/v1/me/comments?personaId=' + persona.id);
    expect(OwnCommentsResponseSchema.parse(await response.json()).data).toEqual([]);
  }
  const own = OwnCommentsResponseSchema.parse(
    await (await writer.http.raw('/api/v1/me/comments?personaId=' + persona.id)).json(),
  );
  expect(own.data).toHaveLength(1);
  expect((await writer.http.raw('/api/v1/me/comments/' + first.id)).status).toBe(200);
  expect((await other.http.raw('/api/v1/me/comments/' + first.id)).status).toBe(404);
  const writerContext = await writer.http.context();
  const writerId = writerContext.data.account?.id;
  if (!writerId) throw new Error('缺少评论账号');
  expect(
    (
      await other.http.raw('/api/v1/me/comments?personaId=' + persona.id, {
        headers: { 'X-Expected-Account': writerId },
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await other.http.write(path, { body: '不能把旧账号输入发给当前账号' }, 'POST', {
        'Idempotency-Key': randomUUID(),
        'X-Expected-Account': writerId,
      })
    ).status,
  ).toBe(409);
  expect((await other.http.raw('/api/v1/admin/comments')).status).toBe(403);
  const approvedResponse = await admin.http.write(
    '/api/v1/admin/comments/' + first.id + '/review',
    {
      revisionId: first.latest.id,
      expectedRevision: first.revision,
      decision: 'approve',
      reason: '',
    },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(approvedResponse.status).toBe(200);
  const approved = AdminCommentResponseSchema.parse(await approvedResponse.json()).data;
  const published = PublicCommentsResponseSchema.parse(
    await (await stack.browser().raw(path)).json(),
  );
  expect(published.meta.publishedCount).toBe(1);
  expect(published.data[0]).toMatchObject({
    status: 'published',
    body,
    release: { id: persona.releaseId, version: '1.0.0' },
  });
  expect(JSON.stringify(published)).not.toContain('latest');
  expect(JSON.stringify(published)).not.toContain('email');
  const editedResponse = await writer.http.write(
    '/api/v1/comments/' + first.id,
    { body: '新的待审正文', expectedRevision: approved.revision },
    'PATCH',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(editedResponse.status).toBe(200);
  const edited = CommentResponseSchema.parse(await editedResponse.json()).data;
  expect(edited.latest.status).toBe('PENDING');
  expect(JSON.stringify(await (await stack.browser().raw(path)).json())).not.toContain(
    '新的待审正文',
  );
  const rejected = await admin.http.write(
    '/api/v1/admin/comments/' + first.id + '/review',
    {
      revisionId: edited.latest.id,
      expectedRevision: edited.revision,
      decision: 'reject',
      reason: '请补充交流上下文',
    },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(rejected.status).toBe(200);
  expect(
    PublicCommentsResponseSchema.parse(await (await stack.browser().raw(path)).json()).data[0],
  ).toMatchObject({ body });
  const audit = await stack.owner.pool.query(
    'SELECT action FROM comment_moderation_records WHERE comment_id=$1 ORDER BY created_at,id',
    [first.id],
  );
  expect(audit.rows.map((row: { action: string }) => row.action)).toEqual(['approve', 'reject']);
});

it('回复限制两层和同作品版本，删除保留楼层，隐藏或封禁不泄露正文与作者，计数即时一致', async () => {
  const { writer, other, owner, admin, persona, path } = await fixture();
  const root = await approve(admin.http, await create(writer.http, path, '公开一级楼层'));
  const pending = await create(other.http, path, '尚未通过的一级评论');
  expect(
    (
      await writer.http.write(path, { body: '不能回复待审楼层', parentId: pending.id }, 'POST', {
        'Idempotency-Key': randomUUID(),
      })
    ).status,
  ).toBe(404);
  const child = await approve(
    admin.http,
    await create(other.http, path, '公开二级回复', { parentId: root.id }),
  );
  const reply = await approve(
    admin.http,
    await create(writer.http, path, '回复二级但保持同一楼层', {
      parentId: root.id,
      replyToId: child.id,
    }),
  );
  expect(
    (
      await writer.http.write(path, { body: '拒绝第三层', parentId: child.id }, 'POST', {
        'Idempotency-Key': randomUUID(),
      })
    ).status,
  ).toBe(404);
  const another = await publish(owner.http, admin.http);
  expect(
    (
      await writer.http.write(
        path,
        { body: '拒绝其他作品版本', releaseId: another.releaseId },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(404);
  const before = await publicComments(path);
  expect(before.meta.publishedCount).toBe(3);
  expect(before.data[0]).toMatchObject({ id: root.id, replyCount: 2 });
  const repliesPath = '/api/v1/comments/' + root.id + '/replies';
  const replies = await publicComments(repliesPath);
  expect(replies.data).toHaveLength(2);
  expect(replies.data[1]).toMatchObject({
    id: reply.id,
    parentId: root.id,
    replyTo: { id: child.id, username: other.username },
  });
  const nextResponse = await owner.http.write(
    '/api/v1/me/personas/' + persona.id + '/releases',
    {
      version: '1.0.1',
      expectedDraftRevision: persona.revision,
      changelog: '评论保持原版本引用',
      confirmed: true,
    },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(nextResponse.status).toBe(200);
  const nextSubmission = SubmissionResponseSchema.parse(await nextResponse.json()).data;
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/moderation/submissions/' + nextSubmission.id + '/review',
        {
          action: 'approve',
          expectedRevision: nextSubmission.revision,
          reason: '核实版本引用不随更新改变',
          selfReviewConfirmed: false,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  expect((await publicComments(path)).data[0]).toMatchObject({
    id: root.id,
    release: { id: persona.releaseId, version: '1.0.0' },
  });
  expect(
    (
      await writer.http.write(
        '/api/v1/comments/' + root.id,
        { expectedRevision: root.revision },
        'DELETE',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  const after = await publicComments(path);
  expect(after.meta.publishedCount).toBe(2);
  expect(after.data[0]).toMatchObject({ status: 'deleted', replyCount: 2 });
  expect(after.data[0]).not.toHaveProperty('body');
  expect(after.data[0]).not.toHaveProperty('author');
  expect((await publicComments(repliesPath)).data).toHaveLength(2);
  const hiddenResponse = await admin.http.write(
    '/api/v1/admin/comments/' + child.id + '/visibility',
    { expectedRevision: child.revision, hidden: true, reason: '核实隐藏占位' },
    'PUT',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(hiddenResponse.status).toBe(200);
  const hidden = AdminCommentResponseSchema.parse(await hiddenResponse.json()).data;
  const hiddenReplies = await publicComments(repliesPath);
  expect(hiddenReplies.meta.publishedCount).toBe(1);
  expect(hiddenReplies.data.find((row) => row.id === child.id)).toMatchObject({ status: 'hidden' });
  expect(JSON.stringify(hiddenReplies)).not.toContain('公开二级回复');
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/comments/' + child.id + '/visibility',
        { expectedRevision: hidden.revision, hidden: false, reason: '核实恢复原获批文本' },
        'PUT',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  await stack.owner.pool.query(
    "UPDATE users SET status='banned',security_version=security_version+1 WHERE username=$1",
    [writer.username],
  );
  const bannedReplies = await publicComments(repliesPath);
  expect(bannedReplies.meta.publishedCount).toBe(1);
  expect(bannedReplies.data.find((row) => row.id === reply.id)).toMatchObject({
    status: 'unavailable',
  });
  expect(JSON.stringify(bannedReplies)).not.toContain('回复二级但保持同一楼层');
  expect((await publicComments(path)).data[0]).toMatchObject({ replyCount: 1 });
});

it('评论读写开关独立，关闭预审仍有自动批准记录，动态字数和频率由真实API执行', async () => {
  const { writer, admin, path } = await fixture();
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET mfa_verified_at=now()-interval '11 minutes',created_at=now()-interval '11 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
    [admin.credentials.username],
  );
  await policy(admin.http, {
    commentReviewMode: 'off',
    commentMaxLength: 5,
    commentsPerMinute: 2,
    likesEnabled: false,
  });
  const first = await create(writer.http, path, '😀😀😀😀😀');
  expect(first.latest.status).toBe('APPROVED');
  expect(
    (
      await writer.http.write(path, { body: '😀'.repeat(6) }, 'POST', {
        'Idempotency-Key': randomUUID(),
      })
    ).status,
  ).toBe(422);
  const second = await create(writer.http, path, '第二条评论');
  const limited = await writer.http.write(path, { body: '第三条评论' }, 'POST', {
    'Idempotency-Key': randomUUID(),
  });
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  const records = await stack.owner.pool.query<{ action: string; actor_id: string | null }>(
    'SELECT action,actor_id FROM comment_moderation_records WHERE comment_id=ANY($1::uuid[])',
    [[first.id, second.id]],
  );
  expect(records.rows).toEqual([
    { action: 'auto_approve', actor_id: null },
    { action: 'auto_approve', actor_id: null },
  ]);
  await policy(admin.http, { commentsEnabled: false });
  expect(
    (
      await writer.http.write(path, { body: '关闭后拒绝' }, 'POST', {
        'Idempotency-Key': randomUUID(),
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await writer.http.write(
        '/api/v1/comments/' + first.id,
        { body: '关闭编辑', expectedRevision: first.revision },
        'PATCH',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(403);
  expect((await publicComments(path)).meta.publishedCount).toBe(2);
  expect(
    (
      await writer.http.write(
        '/api/v1/comments/' + first.id,
        { expectedRevision: first.revision },
        'DELETE',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  await policy(admin.http, { showExistingComments: false });
  const invisible = await publicComments(path);
  expect(invisible.data).toEqual([]);
  expect(invisible.meta.publishedCount).toBe(0);
  expect(invisible.settings.commentsEnabled).toBe(false);
  const preserved = await policy(admin.http, { showExistingComments: true });
  expect(preserved.data.likesEnabled).toBe(false);
  expect((await publicComments(path)).meta.publishedCount).toBe(1);
});

it('身份、CSRF、所有权、重复提交及不可变快照均由服务端和数据库拒绝', async () => {
  const { writer, other, admin, persona, path } = await fixture();
  expect(
    (
      await stack
        .browser()
        .write(path, { body: '游客不能写入' }, 'POST', { 'Idempotency-Key': randomUUID() })
    ).status,
  ).toBe(401);
  expect(
    (await writer.http.raw(path, { method: 'POST', body: JSON.stringify({ body: '没有CSRF' }) }))
      .status,
  ).toBe(403);
  expect((await writer.http.write(path, { body: '没有幂等标识' })).status).toBe(400);
  const key = randomUUID();
  const input = { body: '并发重试只创建一次' };
  const repeated = await Promise.all(
    Array.from({ length: 3 }, () =>
      writer.http.write(path, input, 'POST', { 'Idempotency-Key': key }),
    ),
  );
  expect(repeated.map((response) => response.status)).toEqual([200, 200, 200]);
  const rows = await Promise.all(
    repeated.map(async (response) => CommentResponseSchema.parse(await response.json()).data),
  );
  const row = rows[0];
  if (!row) throw new Error('缺少创建结果');
  expect(new Set(rows.map((item) => item.id)).size).toBe(1);
  expect(
    (
      await writer.http.write(path, { body: '同一标识不同正文' }, 'POST', {
        'Idempotency-Key': key,
      })
    ).status,
  ).toBe(409);
  expect(
    (await writer.http.write(path, input, 'POST', { 'Idempotency-Key': randomUUID() })).status,
  ).toBe(409);
  expect(
    (
      await other.http.write(
        '/api/v1/comments/' + row.id,
        { body: '越权改写', expectedRevision: row.revision },
        'PATCH',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await other.http.write(
        '/api/v1/comments/' + row.id,
        { expectedRevision: row.revision },
        'DELETE',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(404);
  await expect(
    stack.owner.pool.query('UPDATE comment_revisions SET body=$1 WHERE id=$2', [
      '绕过审核直接改写',
      row.latest.id,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    stack.owner.pool.query("UPDATE comment_revisions SET status='APPROVED' WHERE id=$1", [
      row.latest.id,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  expect((await publicComments(path)).meta.publishedCount).toBe(0);
  const approved = await approve(admin.http, row);
  await expect(
    stack.owner.pool.query('DELETE FROM comment_moderation_records WHERE comment_id=$1', [row.id]),
  ).rejects.toMatchObject({ code: '23514' });
  expect(approved.latest.body).toBe(input.body);
  await stack.owner.pool.query('UPDATE users SET email_verified_at=NULL WHERE username=$1', [
    other.username,
  ]);
  expect(
    (
      await other.http.write('/api/v1/auth/login', {
        identifier: other.username,
        password: other.password,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await other.http.write(path, { body: '未验证邮箱不能评论' }, 'POST', {
        'Idempotency-Key': randomUUID(),
      })
    ).status,
  ).toBe(403);
  await stack.owner.pool.query("UPDATE personas SET owner_visibility='hidden' WHERE id=$1", [
    persona.id,
  ]);
  expect((await stack.browser().raw(path)).status).toBe(404);
  expect(
    (
      await writer.http.write(path, { body: '隐藏作品拒绝新增' }, 'POST', {
        'Idempotency-Key': randomUUID(),
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await writer.http.write(
        '/api/v1/comments/' + row.id,
        { expectedRevision: approved.revision },
        'DELETE',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
});

it('并发审核只有一次生效，批量逐项返回失败且相同请求重试不重复审计', async () => {
  const { writer, other, admin, path } = await fixture();
  const first = await create(writer.http, path, '并发审核文本');
  const second = await create(other.http, path, '批量审核另一条文本');
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET mfa_verified_at=now()-interval '11 minutes',created_at=now()-interval '11 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
    [admin.credentials.username],
  );
  const review = {
    revisionId: first.latest.id,
    expectedRevision: first.revision,
    decision: 'approve',
    reason: '',
  };
  const concurrent = await Promise.all(
    Array.from({ length: 2 }, () =>
      admin.http.write('/api/v1/admin/comments/' + first.id + '/review', review, 'POST', {
        'Idempotency-Key': randomUUID(),
      }),
    ),
  );
  expect(concurrent.map((response) => response.status).sort()).toEqual([200, 412]);
  const input = {
    items: [
      {
        id: second.id,
        review: { ...review, revisionId: second.latest.id, expectedRevision: second.revision },
      },
      { id: first.id, review },
    ],
  };
  const key = randomUUID();
  for (let retry = 0; retry < 2; retry++) {
    const response = await admin.http.write('/api/v1/admin/comments/bulk-review', input, 'POST', {
      'Idempotency-Key': key,
    });
    expect(response.status).toBe(200);
    const results = BulkReviewCommentsResponseSchema.parse(await response.json()).data;
    expect(results.map((result) => result.ok)).toEqual([true, false]);
    expect(results[1]).toMatchObject({ id: first.id, error: { code: 'REVISION_CONFLICT' } });
  }
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/comments/bulk-review',
        { items: [input.items[0]] },
        'POST',
        { 'Idempotency-Key': key },
      )
    ).status,
  ).toBe(409);
  const records = await stack.owner.pool.query<{ count: string }>(
    "SELECT count(*) FROM comment_moderation_records WHERE action='approve'",
  );
  expect(Number(records.rows[0]?.count)).toBe(2);
  expect((await publicComments(path)).meta.publishedCount).toBe(2);
});

it('等待配置锁和身份锁的评论在事务内重查开关、封禁及会话版本', async () => {
  const { writer, admin, path } = await fixture();
  const blocker = await stack.owner.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query("SELECT key FROM site_settings WHERE key='community' FOR UPDATE");
    pending = writer.http.write(path, { body: '等待期间关闭评论' }, 'POST', {
      'Idempotency-Key': randomUUID(),
    });
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
      "UPDATE site_settings SET value=jsonb_set(value,'{commentsEnabled}','false'::jsonb),revision=revision+1 WHERE key='community'",
    );
    await blocker.query('COMMIT');
    expect((await pending).status).toBe(403);
    await policy(admin.http, { commentsEnabled: true });
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM users WHERE username=$1 FOR UPDATE', [writer.username]);
    pending = writer.http.write(path, { body: '等待期间封禁账号' }, 'POST', {
      'Idempotency-Key': randomUUID(),
    });
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
      "UPDATE users SET status='banned',security_version=security_version+1 WHERE username=$1",
      [writer.username],
    );
    await blocker.query('COMMIT');
    expect((await pending).status).toBe(401);
    expect((await publicComments(path)).meta.publishedCount).toBe(0);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await pending;
  }
});

it('未绑定MFA的管理员评论自审需要明确确认、理由和近期密码，确认旋转后本人重试', async () => {
  const { admin, path } = await fixture();
  const username = 'comment_' + randomUUID().replaceAll('-', '').slice(0, 12);
  const password = 'Comment administrator fixture passphrase 2026';
  await createAdministrator(stack.owner, {
    username,
    email: username + '@fixture.invalid',
    password,
  });
  const http = stack.browser();
  expect((await http.write('/api/v1/auth/login', { identifier: username, password })).status).toBe(
    200,
  );
  const row = await create(http, path, '管理员自己的待审评论');
  const request = {
    revisionId: row.latest.id,
    expectedRevision: row.revision,
    decision: 'approve',
    reason: '核实本人评论并明确自审',
    selfReviewConfirmed: true,
  };
  expect(
    (
      await http.write(
        '/api/v1/admin/comments/' + row.id + '/review',
        { ...request, selfReviewConfirmed: false },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(403);
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET created_at=now()-interval '11 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
    [username],
  );
  const key = randomUUID();
  const expired = await http.write(
    '/api/v1/admin/comments/' + row.id + '/review',
    request,
    'POST',
    { 'Idempotency-Key': key },
  );
  expect(expired.status).toBe(403);
  expect(ErrorResponseSchema.parse(await expired.json()).error.code).toBe('REAUTH_REQUIRED');
  expect(
    (await http.write('/api/v1/auth/reauthenticate', { currentPassword: password })).status,
  ).toBe(200);
  expect((await publicComments(path)).meta.publishedCount).toBe(0);
  expect(
    (
      await http.write('/api/v1/admin/comments/' + row.id + '/review', request, 'POST', {
        'Idempotency-Key': key,
      })
    ).status,
  ).toBe(200);
  expect((await http.context()).data.mfaEnabled).toBe(false);
  expect((await admin.http.raw('/api/v1/admin/comments/' + row.id)).status).toBe(200);
});

it('已绑定MFA的评论自审在过期时要求MFA，不能用当前密码确认绕过', async () => {
  const { admin, path } = await fixture();
  const row = await create(admin.http, path, '已绑定MFA的管理员评论');
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET mfa_verified_at=now()-interval '11 minutes',created_at=now()-interval '11 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
    [admin.credentials.username],
  );
  const response = await admin.http.write(
    '/api/v1/admin/comments/' + row.id + '/review',
    {
      revisionId: row.latest.id,
      expectedRevision: row.revision,
      decision: 'approve',
      reason: '明确自审',
      selfReviewConfirmed: true,
    },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(response.status).toBe(403);
  expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe('MFA_REQUIRED');
  expect(
    (
      await admin.http.write('/api/v1/auth/reauthenticate', {
        currentPassword: admin.credentials.password,
      })
    ).status,
  ).toBe(403);
  expect((await publicComments(path)).meta.publishedCount).toBe(0);
});
