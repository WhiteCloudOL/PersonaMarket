import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  CommentResponseSchema,
  SubmissionResponseSchema,
  NotificationsResponseSchema,
  OwnReportResponseSchema,
  AdminReportResponseSchema,
  reportEtag,
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
const key = () => ({ 'Idempotency-Key': randomUUID() });
async function inbox(http: AuthHttp) {
  return NotificationsResponseSchema.parse(
    await (await http.raw('/api/v1/me/notifications')).json(),
  );
}
async function publish(owner: AuthHttp, admin: AuthHttp) {
  const persona = await completePersona(owner);
  const result = await owner.write(
    '/api/v1/me/personas/' + persona.id + '/releases',
    {
      version: '1.0.0',
      expectedDraftRevision: persona.revision,
      changelog: '通知验收',
      confirmed: true,
    },
    'POST',
    key(),
  );
  expect(result.status).toBe(200);
  const submission = SubmissionResponseSchema.parse(await result.json()).data;
  const reviewed = await admin.write(
    '/api/v1/admin/moderation/submissions/' + submission.id + '/review',
    {
      action: 'approve',
      expectedRevision: submission.revision,
      reason: '审核通知验收',
      selfReviewConfirmed: false,
    },
    'POST',
    key(),
  );
  expect(reviewed.status).toBe(200);
  return persona;
}
it('审核和公开回复由真实业务事务投递，待审/退回不通知他人，编辑重审不重复回复提醒，隐藏后链接失效', async () => {
  const owner = await verifiedCreator(stack),
    writer = await verifiedCreator(stack),
    admin = await stack.admin();
  const persona = await publish(owner.http, admin.http);
  const path = '/api/v1/personas/' + persona.id + '/comments';
  const rootResponse = await writer.http.write(path, { body: '公开楼层' }, 'POST', key());
  const root = CommentResponseSchema.parse(await rootResponse.json()).data;
  const review = async (
    id: string,
    revisionId: string,
    expectedRevision: number,
    decision: 'approve' | 'reject',
  ) => {
    const response = await admin.http.write(
      '/api/v1/admin/comments/' + id + '/review',
      {
        revisionId,
        expectedRevision,
        decision,
        reason: decision === 'reject' ? '请修改后重提' : '',
      },
      'POST',
      key(),
    );
    expect(response.status).toBe(200);
  };
  await review(root.id, root.latest.id, root.revision, 'approve');
  const replyResponse = await owner.http.write(
    path,
    { body: '待审私密回复不进入提醒', parentId: root.id },
    'POST',
    key(),
  );
  const reply = CommentResponseSchema.parse(await replyResponse.json()).data;
  await stack.tick();
  await expect
    .poll(
      async () =>
        (await inbox(writer.http)).data.filter((row) => row.kind === 'comment_approved').length,
    )
    .toBe(1);
  expect(
    (await inbox(writer.http)).data.filter((row) => row.kind === 'comment_reply'),
  ).toHaveLength(0);
  await review(reply.id, reply.latest.id, reply.revision, 'reject');
  await stack.tick();
  await expect
    .poll(
      async () =>
        (await inbox(owner.http)).data.filter((row) => row.kind === 'comment_rejected').length,
    )
    .toBe(1);
  expect(JSON.stringify(await inbox(writer.http))).not.toContain('待审私密回复');
  const own = await owner.http.raw('/api/v1/me/comments/' + reply.id);
  expect(own.status).toBe(200);
  const rejected = CommentResponseSchema.parse(await own.json()).data;
  const edited = await owner.http.write(
    '/api/v1/comments/' + reply.id,
    { body: 'PUBLIC_REPLY_BODY_SENTINEL_3bf7', expectedRevision: rejected.revision },
    'PATCH',
    key(),
  );
  expect(edited.status).toBe(200);
  const update = CommentResponseSchema.parse(await edited.json()).data;
  await review(update.id, update.latest.id, update.revision, 'approve');
  await expect
    .poll(async () => {
      await stack.tick();
      return (await inbox(writer.http)).data.filter((row) => row.kind === 'comment_reply').length;
    })
    .toBe(1);
  const notification = (await inbox(writer.http)).data.find((row) => row.kind === 'comment_reply');
  expect(notification).toMatchObject({ available: true });
  expect(notification?.path).toContain('#comment-' + reply.id);
  expect(JSON.stringify(notification)).not.toMatch(/待审私密|PUBLIC_REPLY_BODY_SENTINEL_3bf7/);
  const current = CommentResponseSchema.parse(
    await (await owner.http.raw('/api/v1/me/comments/' + reply.id)).json(),
  ).data;
  const editedAgain = await owner.http.write(
    '/api/v1/comments/' + reply.id,
    { body: '公开后再次修改', expectedRevision: current.revision },
    'PATCH',
    key(),
  );
  expect(editedAgain.status).toBe(200);
  const second = CommentResponseSchema.parse(await editedAgain.json()).data;
  await review(second.id, second.latest.id, second.revision, 'approve');
  await stack.tick();
  expect(
    (await inbox(writer.http)).data.filter((row) => row.kind === 'comment_reply'),
  ).toHaveLength(1);
  const approved = CommentResponseSchema.parse(
    await (await owner.http.raw('/api/v1/me/comments/' + reply.id)).json(),
  ).data;
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/comments/' + reply.id + '/visibility',
        {
          hidden: true,
          expectedRevision: approved.revision,
          reason: '核对通知权限边界',
          selfReviewConfirmed: false,
        },
        'PUT',
        key(),
      )
    ).status,
  ).toBe(200);
  expect((await inbox(writer.http)).data.find((row) => row.kind === 'comment_reply')).toMatchObject(
    { available: false, path: null },
  );
  await expect
    .poll(async () => {
      await stack.tick();
      return (await inbox(owner.http)).data.find((row) => row.kind === 'comment_state');
    })
    .toMatchObject({ available: true });
  expect(
    (await inbox(owner.http)).data.find((row) => row.kind === 'release_approved'),
  ).toMatchObject({ available: true, path: '/dashboard/personas/' + persona.id + '/releases' });
});
it('举报对外处理产生通知，内部备注不产生提醒也不泄露；密码改变同时保存安全通知', async () => {
  const owner = await verifiedCreator(stack),
    reporter = await verifiedCreator(stack),
    admin = await stack.admin();
  const persona = await publish(owner.http, admin.http);
  const created = await reporter.http.write(
    '/api/v1/reports',
    { target: { type: 'persona', personaId: persona.id }, reason: 'other', details: '私有证据' },
    'POST',
    key(),
  );
  expect(created.status).toBe(200);
  const report = OwnReportResponseSchema.parse(await created.json()).data;
  const act = async (revision: number, action: 'note' | 'accept', message: string) => {
    const response = await admin.http.write(
      '/api/v1/admin/reports/' + report.id + '/actions',
      {
        action,
        message,
        privateNote: '管理员私有备注',
        confirmed: true,
        selfReviewConfirmed: false,
      },
      'POST',
      { ...key(), 'If-Match': reportEtag(report.id, revision) },
    );
    expect(response.status).toBe(200);
    return AdminReportResponseSchema.parse(await response.json()).data;
  };
  const noted = await act(report.revision, 'note', '');
  await stack.tick();
  expect((await inbox(reporter.http)).data).toHaveLength(0);
  await act(noted.revision, 'accept', '已收到并受理');
  await expect
    .poll(async () => {
      await stack.tick();
      return (await inbox(reporter.http)).data.length;
    })
    .toBe(1);
  const notification = (await inbox(reporter.http)).data[0];
  expect(notification).toMatchObject({
    kind: 'report_updated',
    available: true,
    path: '/dashboard/reports?report=' + report.id,
  });
  expect(JSON.stringify(notification)).not.toMatch(/私有证据|管理员私有备注/);
  const changed = await reporter.http.write(
    '/api/v1/me/security/password',
    { currentPassword: reporter.password, newPassword: 'Changed notification passphrase 2026' },
    'POST',
  );
  expect(changed.status).toBe(200);
  expect(
    (
      await reporter.http.write('/api/v1/auth/login', {
        identifier: reporter.username,
        password: 'Changed notification passphrase 2026',
      })
    ).status,
  ).toBe(200);
  await expect
    .poll(async () => {
      await stack.tick();
      return (await inbox(reporter.http)).data.filter((row) => row.kind === 'account_security')
        .length;
    })
    .toBe(1);
  expect(JSON.stringify(await inbox(reporter.http))).not.toContain(
    'Changed notification passphrase',
  );
});
