import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  AdminReportResponseSchema,
  AdminReportRecordsResponseSchema,
  AdminReportsResponseSchema,
  CommentResponseSchema,
  AdminCommentResponseSchema,
  OwnReportResponseSchema,
  OwnReportsResponseSchema,
  OwnReportRecordsResponseSchema,
  SubmissionResponseSchema,
  ErrorResponseSchema,
  reportEtag,
  type AdminReportAction,
  type CreateReport,
} from '@personamarket/contracts';
import { createAdministrator } from '@personamarket/server';
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
const nonce = () => ({ 'Idempotency-Key': randomUUID() });
async function publish(owner: AuthHttp, reviewer: AuthHttp) {
  const persona = await completePersona(owner);
  const response = await owner.write(
    '/api/v1/me/personas/' + persona.id + '/releases',
    {
      version: '1.0.0',
      expectedDraftRevision: persona.revision,
      changelog: '举报权限测试作品',
      confirmed: true,
    },
    'POST',
    nonce(),
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
          reason: '核实公开测试内容',
          selfReviewConfirmed: false,
        },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(200);
  return { ...persona, releaseId: submission.releaseId };
}
async function fixture() {
  const owner = await verifiedCreator(stack),
    reporter = await verifiedCreator(stack),
    admin = await stack.admin();
  const persona = await publish(owner.http, admin.http);
  const input: CreateReport = {
    target: { type: 'persona', personaId: persona.id },
    reason: 'copyright',
    details: '私有线索\nhttps://fixture.invalid/proof',
  };
  return { owner, reporter, admin, persona, input };
}
async function create(http: AuthHttp, input: CreateReport) {
  const response = await http.write('/api/v1/reports', input, 'POST', nonce());
  expect(response.status).toBe(200);
  return OwnReportResponseSchema.parse(await response.json()).data;
}
function action(
  http: AuthHttp,
  id: string,
  revision: number,
  input: Partial<AdminReportAction> = {},
  key = randomUUID(),
) {
  return http.write(
    '/api/v1/admin/reports/' + id + '/actions',
    {
      action: 'accept',
      message: '已经受理，正在核实',
      privateNote: '',
      confirmed: true,
      selfReviewConfirmed: false,
      ...input,
    },
    'POST',
    { 'Idempotency-Key': key, 'If-Match': reportEtag(id, revision) },
  );
}

it('公开目标举报具有私有归属、严格输入、CSRF、幂等和重复限制，独立举报人互不泄露', async () => {
  const { owner, reporter, admin, persona, input } = await fixture();
  expect((await stack.browser().write('/api/v1/reports', input, 'POST', nonce())).status).toBe(401);
  expect(
    (
      await reporter.http.raw('/api/v1/reports', {
        method: 'POST',
        body: JSON.stringify(input),
        headers: nonce(),
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await reporter.http.write(
        '/api/v1/reports',
        { ...input, reporterId: randomUUID() },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(400);
  const key = nonce();
  const response = await reporter.http.write('/api/v1/reports', input, 'POST', key);
  expect(response.status).toBe(200);
  const report = OwnReportResponseSchema.parse(await response.json()).data;
  expect(report).toMatchObject({
    status: 'pending',
    revision: 1,
    details: input.details,
    snapshot: { releaseId: persona.releaseId, type: 'persona' },
  });
  expect(report.snapshot).not.toHaveProperty('content');
  expect(JSON.stringify(report)).not.toContain('email');
  const replay = await reporter.http.write('/api/v1/reports', input, 'POST', key);
  expect(replay.status).toBe(200);
  expect(OwnReportResponseSchema.parse(await replay.json()).data.id).toBe(report.id);
  expect((await reporter.http.write('/api/v1/reports', input, 'POST', nonce())).status).toBe(409);
  const otherReport = await create(owner.http, input);
  expect(otherReport.id).not.toBe(report.id);
  const ownPath = '/api/v1/me/reports/' + report.id;
  expect((await owner.http.raw(ownPath)).status).toBe(404);
  expect((await owner.http.raw(ownPath + '/records')).status).toBe(404);
  expect((await reporter.http.raw('/api/v1/admin/reports')).status).toBe(403);
  const mine = OwnReportsResponseSchema.parse(
    await (await reporter.http.raw('/api/v1/me/reports')).json(),
  );
  expect(mine.meta.total).toBe(1);
  expect(mine.data[0]?.id).toBe(report.id);
  expect(JSON.stringify(mine)).not.toContain(input.details);
  const queue = AdminReportsResponseSchema.parse(
    await (await admin.http.raw('/api/v1/admin/reports?type=persona')).json(),
  );
  expect(queue.meta.total).toBe(2);
  expect(JSON.stringify(queue)).not.toContain(reporter.email);
  await expect(
    stack.owner.pool.query(
      `INSERT INTO reports(reporter_id,reported_user_id,type,target_id,target_revision_id,persona_id,release_id,target_title,reason,details,snapshot,content_hash,updated_by)
     SELECT reporter_id,reported_user_id,type,target_id,target_revision_id,persona_id,release_id,target_title,reason,details,snapshot,content_hash,updated_by FROM reports WHERE id=$1`,
      [report.id],
    ),
  ).rejects.toMatchObject({ code: '23505', constraint: 'reports_active_actor_target_unique' });
});

it('真实受理、内部备注和终结记录原子保存，普通处理不追加近期验证，并发只有一个成功', async () => {
  const { reporter, admin, persona, input } = await fixture();
  const secondAdmin = await stack.admin();
  const report = await create(reporter.http, input);
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET mfa_verified_at=now()-interval '20 minutes',created_at=now()-interval '20 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
    [admin.credentials.username],
  );
  const path = '/api/v1/admin/reports/' + report.id;
  const key = randomUUID();
  const accepted = await action(admin.http, report.id, 1, { privateNote: '后台私有核验线索' }, key);
  expect(accepted.status).toBe(200);
  expect(accepted.headers.get('etag')).toBe(reportEtag(report.id, 2));
  expect(AdminReportResponseSchema.parse(await accepted.json()).data.status).toBe('processing');
  expect(
    (await action(admin.http, report.id, 1, { privateNote: '后台私有核验线索' }, key)).status,
  ).toBe(200);
  const privateNote = await action(admin.http, report.id, 2, {
    action: 'note',
    message: '',
    privateNote: '仅后台可见的记录',
  });
  expect(privateNote.status).toBe(200);
  expect((await action(admin.http, report.id, 2, { action: 'resolve' })).status).toBe(412);
  const racing = await Promise.all([
    action(admin.http, report.id, 3, { action: 'resolve', message: '核实后已完成处理' }),
    action(secondAdmin.http, report.id, 3, { action: 'dismiss', message: '核实后不予受理' }),
  ]);
  expect(racing.map((r) => r.status).sort()).toEqual([200, 412]);
  const current = AdminReportResponseSchema.parse(await (await admin.http.raw(path)).json()).data;
  expect(current.revision).toBe(4);
  expect(['resolved', 'dismissed']).toContain(current.status);
  expect((await action(admin.http, report.id, 4)).status).toBe(409);
  expect((await reporter.http.write('/api/v1/reports', input, 'POST', nonce())).status).toBe(409);
  const ownRecords = OwnReportRecordsResponseSchema.parse(
    await (await reporter.http.raw('/api/v1/me/reports/' + report.id + '/records')).json(),
  );
  const records = AdminReportRecordsResponseSchema.parse(
    await (await admin.http.raw(path + '/records')).json(),
  );
  expect(ownRecords.meta.total).toBe(3);
  expect(records.meta.total).toBe(4);
  expect(JSON.stringify(ownRecords)).not.toContain('后台');
  expect(JSON.stringify(ownRecords)).not.toContain('privateNote');
  expect(records.data.filter((r) => r.action === 'accepted')).toHaveLength(1);
  expect((await stack.browser().raw('/api/v1/personas/' + persona.id)).status).toBe(200);
  await expect(
    stack.owner.pool.query(
      "UPDATE reports SET details='篡改证据',revision=revision+1 WHERE id=$1",
      [report.id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    stack.owner.pool.query('DELETE FROM reports WHERE id=$1', [report.id]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    stack.owner.pool.query("UPDATE report_actions SET message='篡改记录' WHERE report_id=$1", [
      report.id,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    stack.owner.pool.query('DELETE FROM report_actions WHERE report_id=$1', [report.id]),
  ).rejects.toMatchObject({ code: '23514' });
  expect(
    (
      await stack.owner.pool.query(
        'SELECT count(*)::integer AS amount FROM auth_audit_events WHERE event LIKE $1',
        ['admin.report_%'],
      )
    ).rows[0]?.amount,
  ).toBe(3);
});

it('评论举报只冻结获批正文，待审改稿和隐藏内容不泄露，隐藏后仍保留私有证据', async () => {
  const { owner, reporter, admin, persona } = await fixture();
  const publicBody = '已公开的评论原文' + String.fromCharCode(133) + '保留全部获批字符';
  const response = await owner.http.write(
    '/api/v1/personas/' + persona.id + '/comments',
    { body: publicBody },
    'POST',
    nonce(),
  );
  expect(response.status).toBe(200);
  const pending = CommentResponseSchema.parse(await response.json()).data;
  const input: CreateReport = {
    target: { type: 'comment', commentId: pending.id },
    reason: 'inappropriate',
    details: '私有补充说明',
  };
  expect((await reporter.http.write('/api/v1/reports', input, 'POST', nonce())).status).toBe(404);
  const review = await admin.http.write(
    '/api/v1/admin/comments/' + pending.id + '/review',
    {
      revisionId: pending.latest.id,
      expectedRevision: pending.revision,
      decision: 'approve',
      reason: '',
    },
    'POST',
    nonce(),
  );
  expect(review.status).toBe(200);
  const approved = AdminCommentResponseSchema.parse(await review.json()).data;
  const editedResponse = await owner.http.write(
    '/api/v1/comments/' + pending.id,
    {
      body: '绝不能泄漏的待审改稿',
      expectedRevision: approved.revision,
    },
    'PATCH',
    nonce(),
  );
  expect(editedResponse.status).toBe(200);
  const edited = CommentResponseSchema.parse(await editedResponse.json()).data;
  const report = await create(reporter.http, input);
  expect(report.snapshot).toMatchObject({
    type: 'comment',
    comment: { revisionId: pending.latest.id, body: publicBody },
  });
  expect(JSON.stringify(report)).not.toContain('绝不能泄漏');
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/comments/' + pending.id + '/visibility',
        {
          expectedRevision: edited.revision,
          hidden: true,
          reason: '核验举报隐藏边界',
        },
        'PUT',
        nonce(),
      )
    ).status,
  ).toBe(200);
  const saved = OwnReportResponseSchema.parse(
    await (await reporter.http.raw('/api/v1/me/reports/' + report.id)).json(),
  ).data;
  expect(saved.snapshot).toEqual(report.snapshot);
  expect(saved.publicPath).toBeNull();
  const third = await verifiedCreator(stack);
  expect((await third.http.write('/api/v1/reports', input, 'POST', nonce())).status).toBe(404);
  expect((await owner.http.raw('/api/v1/me/reports/' + report.id)).status).toBe(404);
});

it('管理员涉及自己时必须明确确认，绑定 MFA 不能用密码绕过；未绑定账号通过密码旋转会话后重试', async () => {
  const { admin, persona } = await fixture();
  const input: CreateReport = {
    target: { type: 'persona', personaId: persona.id },
    reason: 'other',
    details: '',
  };
  const own = await create(admin.http, input);
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET mfa_verified_at=now()-interval '20 minutes',created_at=now()-interval '20 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
    [admin.credentials.username],
  );
  expect((await admin.http.raw('/api/v1/admin/reports')).status).toBe(200);
  expect((await action(admin.http, own.id, 1)).status).toBe(403);
  const mfa = await action(admin.http, own.id, 1, { selfReviewConfirmed: true });
  expect(mfa.status).toBe(403);
  expect(ErrorResponseSchema.parse(await mfa.json()).error.code).toBe('MFA_REQUIRED');
  expect(
    (
      await admin.http.write('/api/v1/auth/reauthenticate', {
        currentPassword: admin.credentials.password,
      })
    ).status,
  ).toBe(403);
  const username = 'report_admin_' + randomUUID().replaceAll('-', '').slice(0, 10),
    password = 'Report administrator fixture passphrase 2026';
  await createAdministrator(stack.owner, {
    username,
    email: username + '@fixture.invalid',
    password,
  });
  const http = stack.browser();
  expect((await http.write('/api/v1/auth/login', { identifier: username, password })).status).toBe(
    200,
  );
  const unbound = await create(http, input);
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET created_at=now()-interval '20 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
    [username],
  );
  const expired = await action(http, unbound.id, 1, { selfReviewConfirmed: true });
  expect(expired.status).toBe(403);
  expect(ErrorResponseSchema.parse(await expired.json()).error.code).toBe('REAUTH_REQUIRED');
  const before = [...http.cookies];
  expect(
    (await http.write('/api/v1/auth/reauthenticate', { currentPassword: password })).status,
  ).toBe(200);
  expect([...http.cookies]).not.toEqual(before);
  expect((await action(http, unbound.id, 1, { selfReviewConfirmed: true })).status).toBe(200);
});

it('举报读取超时后可恢复，换号核对、分页校验、审核员权限和账号撤权都由真实 API 执行', async () => {
  const { reporter, admin, input } = await fixture();
  const report = await create(reporter.http, input);
  expect(
    (
      await reporter.http.raw('/api/v1/me/reports', {
        headers: { 'X-Expected-Account': randomUUID() },
      })
    ).status,
  ).toBe(409);
  expect((await reporter.http.raw('/api/v1/me/reports?page=501')).status).toBe(400);
  expect((await admin.http.raw('/api/v1/admin/reports?type=unknown')).status).toBe(400);
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/reports/' + report.id + '/actions',
        { action: 'accept', message: '核对缺少并发凭据', privateNote: '', confirmed: true },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(400);
  const lock = await stack.owner.pool.connect();
  try {
    await lock.query('BEGIN');
    await lock.query('LOCK TABLE reports IN ACCESS EXCLUSIVE MODE');
    const response = await admin.http.raw('/api/v1/admin/reports');
    expect(response.status).toBe(503);
    expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe('SERVICE_UNAVAILABLE');
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
  }
  expect((await admin.http.raw('/api/v1/admin/reports')).status).toBe(200);
  await stack.owner.pool.query("UPDATE users SET role='moderator' WHERE username=$1", [
    reporter.username,
  ]);
  const moderator = stack.browser();
  expect(
    (
      await moderator.write('/api/v1/auth/login', {
        identifier: reporter.username,
        password: reporter.password,
      })
    ).status,
  ).toBe(200);
  expect((await moderator.raw('/api/v1/admin/reports')).status).toBe(403);
  await stack.admin();
  await stack.owner.pool.query("UPDATE users SET status='banned' WHERE username=$1", [
    admin.credentials.username,
  ]);
  expect((await admin.http.raw('/api/v1/admin/reports/' + report.id)).status).toBe(401);
});
