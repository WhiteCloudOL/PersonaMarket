import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  AdminPersonaResponseSchema,
  AdminCommentResponseSchema,
  CommentResponseSchema,
  AdminReportResponseSchema,
  AdminReportRecordsResponseSchema,
  AdminUserResponseSchema,
  ErrorResponseSchema,
  OwnReportResponseSchema,
  OwnReportRecordsResponseSchema,
  SubmissionResponseSchema,
  reportEtag,
  type AdminReportAction,
  type ReportResolution,
} from '@personamarket/contracts';
import { createAdministrator } from '@personamarket/server';
import type { AuthHttp } from '../fixtures/auth-http.js';
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
async function fixture() {
  const owner = await verifiedCreator(stack),
    reporter = await verifiedCreator(stack),
    admin = await stack.admin();
  const persona = await completePersona(owner.http);
  const submitted = await owner.http.write(
    '/api/v1/me/personas/' + persona.id + '/releases',
    {
      version: '1.0.0',
      expectedDraftRevision: persona.revision,
      changelog: '真实举报处置作品',
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
          expectedRevision: submission.revision,
          reason: '隔离验收公开作品',
          selfReviewConfirmed: false,
        },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(200);
  const created = await reporter.http.write(
    '/api/v1/reports',
    {
      target: { type: 'persona', personaId: persona.id, releaseId: submission.releaseId },
      reason: 'copyright',
      details: '只供举报人和管理员读取的线索',
    },
    'POST',
    nonce(),
  );
  expect(created.status).toBe(200);
  const report = OwnReportResponseSchema.parse(await created.json()).data;
  const target = AdminPersonaResponseSchema.parse(
    await (await admin.http.raw('/api/v1/admin/personas/' + persona.id)).json(),
  ).data;
  const ownerId = (await owner.http.context()).data.account?.id;
  if (!ownerId) throw new Error('缺少测试作者');
  const user = AdminUserResponseSchema.parse(
    await (await admin.http.raw('/api/v1/admin/users/' + ownerId)).json(),
  ).data;
  return {
    owner,
    ownerId,
    reporter,
    admin,
    persona,
    releaseId: submission.releaseId,
    report,
    target,
    user,
  };
}

it('举报结案与下架、限号、领域记录和Outbox原子提交，幂等重试不产生重复处置', async () => {
  const f = await fixture();
  const path = '/api/v1/admin/reports/' + f.report.id + '/actions',
    key = randomUUID();
  const input = {
    action: 'resolve',
    message: '已核实并下架内容、限制账号',
    privateNote: '内部核对过程不可进入通知',
    confirmed: true,
    selfReviewConfirmed: false,
    resolution: {
      reason: '被处置者可见的独立内容说明',
      content: { action: 'block_persona', expectedRevision: f.target.revision },
      account: {
        action: 'ban',
        expectedSecurityVersion: f.user.securityVersion,
        scope: 'account_only',
      },
    },
  };
  const headers = {
    'Idempotency-Key': key,
    'If-Match': reportEtag(f.report.id, f.report.revision),
  };
  const result = await f.admin.http.write(path, input, 'POST', headers);
  expect(result.status).toBe(200);
  expect((await f.admin.http.write(path, input, 'POST', headers)).status).toBe(200);
  const rows = (
    await stack.owner.pool.query(
      `SELECT r.status,r.revision,p.moderation_state,u.status AS user_status,
    (SELECT count(*)::int FROM report_actions a WHERE a.report_id=r.id AND a.action='resolved') AS actions,
    (SELECT count(*)::int FROM report_resolutions x JOIN report_actions a ON a.id=x.action_id WHERE a.report_id=r.id) AS resolutions,
    (SELECT count(*)::int FROM moderation_records m WHERE m.persona_id=p.id AND m.action='persona_blocked') AS content_records,
    (SELECT count(*)::int FROM user_management_records m WHERE m.target_id=u.id AND m.action='ban') AS account_records
    FROM reports r JOIN personas p ON p.id=r.persona_id JOIN users u ON u.id=r.reported_user_id WHERE r.id=$1`,
      [f.report.id],
    )
  ).rows;
  expect(rows).toEqual([
    expect.objectContaining({
      status: 'resolved',
      revision: 2,
      moderation_state: 'blocked',
      user_status: 'banned',
      actions: 1,
      resolutions: 1,
      content_records: 1,
      account_records: 1,
    }),
  ]);
  expect((await stack.browser().raw('/api/v1/personas/' + f.persona.id)).status).toBe(404);
  expect((await f.owner.http.raw('/api/v1/me/personas')).status).toBe(401);
  const queued = (
    await stack.owner.pool.query(
      "SELECT n.id,n.event_id,n.status,n.message FROM notifications n JOIN report_actions a ON a.id=n.source_id WHERE a.report_id=$1 AND n.kind='report_updated'",
      [f.report.id],
    )
  ).rows;
  expect(queued).toHaveLength(1);
  expect(queued[0]?.message).toBe(input.message);
  expect(JSON.stringify(queued)).not.toContain(input.privateNote);
  await stack.tick();
  await expect
    .poll(
      async () =>
        (
          await stack.owner.pool.query('SELECT status FROM notifications WHERE id=$1', [
            queued[0]?.id,
          ])
        ).rows[0]?.status,
      { timeout: 10000 },
    )
    .toBe('delivered');
  expect((await f.reporter.http.raw('/api/v1/me/reports/' + f.report.id)).status).toBe(200);
  const own = OwnReportRecordsResponseSchema.parse(
    await (await f.reporter.http.raw('/api/v1/me/reports/' + f.report.id + '/records')).json(),
  );
  expect(own.data[0]?.resolution).toEqual({ content: 'block_persona', account: 'ban' });
  expect(JSON.stringify(own)).not.toContain(input.privateNote);
  expect(JSON.stringify(own)).not.toContain(input.resolution.reason);
  expect(JSON.stringify(own)).not.toContain('securityVersion');
  const records = AdminReportRecordsResponseSchema.parse(
    await (await f.admin.http.raw('/api/v1/admin/reports/' + f.report.id + '/records')).json(),
  );
  expect(records.data[0]?.resolutionDetail?.command).toEqual(input.resolution);
  const receipt = records.data[0]?.id;
  await expect(
    stack.owner.pool.query("UPDATE report_resolutions SET command='{}' WHERE action_id=$1", [
      receipt,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    stack.owner.pool.query('DELETE FROM report_resolutions WHERE action_id=$1', [receipt]),
  ).rejects.toMatchObject({ code: '23514' });
  const reasons = (
    await stack.owner.pool.query(
      "SELECT reason FROM moderation_records WHERE persona_id=$1 AND action='persona_blocked' UNION ALL SELECT reason FROM user_management_records WHERE target_id=$2 AND action='ban'",
      [f.persona.id, f.ownerId],
    )
  ).rows;
  expect(reasons).toEqual([
    { reason: input.resolution.reason },
    { reason: input.resolution.reason },
  ]);
});

type Fixture = Awaited<ReturnType<typeof fixture>>;
function resolution(f: Fixture): ReportResolution {
  return {
    reason: '被处置者可见的独立处置说明',
    content: { action: 'block_persona', expectedRevision: f.target.revision },
    account: {
      action: 'ban',
      scope: 'account_only',
      expectedSecurityVersion: f.user.securityVersion,
    },
  };
}
function act(http: AuthHttp, f: Fixture, disposition: ReportResolution, key = randomUUID()) {
  const input: AdminReportAction = {
    action: 'resolve',
    message: '举报人可见的结案说明',
    privateNote: '管理员内部核验线索',
    confirmed: true,
    selfReviewConfirmed: false,
    resolution: disposition,
  };
  return http.write('/api/v1/admin/reports/' + f.report.id + '/actions', input, 'POST', {
    'Idempotency-Key': key,
    'If-Match': reportEtag(f.report.id, f.report.revision),
  });
}
async function expectUnchanged(f: Fixture) {
  const rows = (
    await stack.owner.pool.query(
      `SELECT r.status,r.revision,p.moderation_state,u.status AS user_status,
    (SELECT count(*)::int FROM report_actions a WHERE a.report_id=r.id AND a.action='resolved') AS resolutions,
    (SELECT count(*)::int FROM moderation_records m WHERE m.persona_id=p.id AND m.action='persona_blocked') AS content_records,
    (SELECT count(*)::int FROM notifications n JOIN report_actions a ON a.id=n.source_id WHERE a.report_id=r.id) AS notices
    FROM reports r JOIN personas p ON p.id=r.persona_id JOIN users u ON u.id=r.reported_user_id WHERE r.id=$1`,
      [f.report.id],
    )
  ).rows;
  expect(rows).toEqual([
    {
      status: 'pending',
      revision: 1,
      moderation_state: 'normal',
      user_status: 'active',
      resolutions: 0,
      content_records: 0,
      notices: 0,
    },
  ]);
}

it('内容或账号修订冲突时，先完成的内容操作、审计和通知也整体回滚', async () => {
  const f = await fixture();
  expect(
    (
      await act(f.admin.http, f, {
        reason: '不能跨类型处置',
        content: { action: 'hide_comment', expectedRevision: 1 },
      })
    ).status,
  ).toBe(400);
  await expectUnchanged(f);
  const staleContent = resolution(f);
  if (!staleContent.content) throw Error('缺少内容命令');
  staleContent.content.expectedRevision++;
  expect((await act(f.admin.http, f, staleContent)).status).toBe(412);
  await expectUnchanged(f);
  const staleAccount = resolution(f);
  if (!staleAccount.account) throw Error('缺少账号命令');
  staleAccount.account.expectedSecurityVersion++;
  const key = randomUUID();
  expect((await act(f.admin.http, f, staleAccount, key)).status).toBe(412);
  await expectUnchanged(f);
  expect((await stack.browser().raw('/api/v1/personas/' + f.persona.id)).status).toBe(200);
  // 失败没有消费幂等键，刷新命令后可用同一个键正常提交
  expect((await act(f.admin.http, f, resolution(f), key)).status).toBe(200);
});

it('两个管理员同时处置同一举报，仅一个结案及一份领域记录和通知提交', async () => {
  const f = await fixture();
  const second = await stack.admin();
  const command = resolution(f);
  const racing = await Promise.all([act(f.admin.http, f, command), act(second.http, f, command)]);
  expect(racing.map((r) => r.status).sort()).toEqual([200, 412]);
  const rows = (
    await stack.owner.pool.query(
      `SELECT
    (SELECT count(*)::int FROM report_resolutions x JOIN report_actions a ON a.id=x.action_id WHERE a.report_id=$1) AS receipts,
    (SELECT count(*)::int FROM moderation_records WHERE persona_id=$2 AND action='persona_blocked') AS content,
    (SELECT count(*)::int FROM user_management_records WHERE target_id=$3 AND action='ban') AS accounts,
    (SELECT count(*)::int FROM notifications n JOIN report_actions a ON a.id=n.source_id WHERE a.report_id=$1 AND n.kind='report_updated') AS notices`,
      [f.report.id, f.persona.id, f.ownerId],
    )
  ).rows;
  expect(rows).toEqual([{ receipts: 1, content: 1, accounts: 1, notices: 1 }]);
});

it('结案同时下架整个人设并封禁全部作品时不重复处置，其他私有草稿和举报人信息仍隔离', async () => {
  const f = await fixture();
  const privatePersona = await completePersona(f.owner.http);
  const before = (
    await stack.owner.pool.query('SELECT payload FROM persona_drafts WHERE persona_id=$1', [
      privatePersona.id,
    ])
  ).rows;
  const command = resolution(f);
  if (!command.account) throw Error('缺少账号处置');
  command.account.scope = 'account_and_personas';
  expect((await act(f.admin.http, f, command)).status).toBe(200);
  const actions = (
    await stack.owner.pool.query(
      "SELECT persona_id,action,reason FROM moderation_records WHERE persona_id=ANY($1::uuid[]) AND action IN ('persona_blocked','account_ban_persona_blocked') ORDER BY action",
      [[f.persona.id, privatePersona.id]],
    )
  ).rows;
  expect(actions).toEqual([
    {
      persona_id: privatePersona.id,
      action: 'account_ban_persona_blocked',
      reason: command.reason,
    },
    { persona_id: f.persona.id, action: 'persona_blocked', reason: command.reason },
  ]);
  expect(
    (
      await stack.owner.pool.query('SELECT payload FROM persona_drafts WHERE persona_id=$1', [
        privatePersona.id,
      ])
    ).rows,
  ).toEqual(before);
  const records = AdminReportRecordsResponseSchema.parse(
    await (await f.admin.http.raw('/api/v1/admin/reports/' + f.report.id + '/records')).json(),
  );
  expect(records.data[0]?.resolutionDetail?.result.account?.affectedPersonas).toBe(1);
  const own = OwnReportRecordsResponseSchema.parse(
    await (await f.reporter.http.raw('/api/v1/me/reports/' + f.report.id + '/records')).json(),
  );
  expect(own.data[0]?.resolution).toEqual({ content: 'block_persona', account: 'ban' });
  expect(JSON.stringify(own)).not.toContain(privatePersona.id);
  expect(JSON.stringify(own)).not.toContain(command.reason);
  expect((await stack.browser().raw('/api/v1/personas/' + f.persona.id)).status).toBe(404);
});

it('处置及幂等重放都重查实际MFA，未绑定管理员通过密码旋转会话后由本人重试', async () => {
  const f = await fixture();
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET mfa_verified_at=now()-interval '20 minutes',created_at=now()-interval '20 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
    [f.admin.credentials.username],
  );
  const mfa = await act(f.admin.http, f, resolution(f));
  expect(mfa.status).toBe(403);
  expect(ErrorResponseSchema.parse(await mfa.json()).error.code).toBe('MFA_REQUIRED');
  expect((await f.admin.http.raw('/api/v1/admin/reports/' + f.report.id)).status).toBe(200);
  expect(
    (
      await f.admin.http.write('/api/v1/auth/reauthenticate', {
        currentPassword: f.admin.credentials.password,
      })
    ).status,
  ).toBe(403);
  await expectUnchanged(f);
  const username = 'report_resolution_' + randomUUID().replaceAll('-', '').slice(0, 10),
    password = 'Resolution administrator passphrase 2026';
  await createAdministrator(stack.owner, {
    username,
    email: username + '@fixture.invalid',
    password,
  });
  const unbound = stack.browser();
  expect(
    (await unbound.write('/api/v1/auth/login', { identifier: username, password })).status,
  ).toBe(200);
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET created_at=now()-interval '20 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
    [username],
  );
  const key = randomUUID(),
    command = resolution(f);
  const expired = await act(unbound, f, command, key);
  expect(expired.status).toBe(403);
  expect(ErrorResponseSchema.parse(await expired.json()).error.code).toBe('REAUTH_REQUIRED');
  await expectUnchanged(f);
  const previous = [...unbound.cookies];
  expect(
    (await unbound.write('/api/v1/auth/reauthenticate', { currentPassword: password })).status,
  ).toBe(200);
  expect([...unbound.cookies]).not.toEqual(previous);
  expect((await act(unbound, f, command, key)).status).toBe(200);
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET created_at=now()-interval '20 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
    [username],
  );
  const replay = await act(unbound, f, command, key);
  expect(replay.status).toBe(403);
  expect(ErrorResponseSchema.parse(await replay.json()).error.code).toBe('REAUTH_REQUIRED');
});

it('指定已发布版本的处置使用单调修订并保留不可变快照，失效版本不再公开', async () => {
  const f = await fixture();
  const detail = AdminReportResponseSchema.parse(
    await (await f.admin.http.raw('/api/v1/admin/reports/' + f.report.id)).json(),
  ).data;
  if (!detail.moderation.release) throw Error('真实版本举报缺少版本管理状态');
  const before = (
    await stack.owner.pool.query(
      'SELECT s.content_hash,s.snapshot,s.publication FROM persona_releases r JOIN release_submissions s ON s.id=r.approved_submission_id WHERE r.id=$1',
      [f.releaseId],
    )
  ).rows;
  const command: ReportResolution = {
    reason: '被处置者可见的版本说明',
    content: { action: 'block_release', expectedRevision: detail.moderation.release.revision },
  };
  expect((await act(f.admin.http, f, command)).status).toBe(200);
  const after = AdminReportResponseSchema.parse(
    await (await f.admin.http.raw('/api/v1/admin/reports/' + f.report.id)).json(),
  ).data;
  expect(after.moderation.release).toEqual({
    state: 'BLOCKED',
    revision: detail.moderation.release.revision + 1,
  });
  expect(after.publicPath).toBeNull();
  expect(
    (await stack.browser().raw('/api/v1/personas/' + f.persona.id + '/releases/' + f.releaseId))
      .status,
  ).toBe(404);
  expect((await stack.browser().raw('/api/v1/personas/' + f.persona.id)).status).toBe(404);
  const immutable = (
    await stack.owner.pool.query(
      'SELECT s.content_hash,s.snapshot,s.publication FROM persona_releases r JOIN release_submissions s ON s.id=r.approved_submission_id WHERE r.id=$1',
      [f.releaseId],
    )
  ).rows;
  expect(immutable).toEqual(before);
  await expect(
    stack.owner.pool.query(
      'UPDATE persona_releases SET moderation_revision=moderation_revision+1 WHERE id=$1',
      [f.releaseId],
    ),
  ).rejects.toMatchObject({ code: '23514' });
});

it('封禁再恢复后旧修订仍被拒绝，不能通过状态恢复绕过版本并发校验', async () => {
  const f = await fixture();
  const detail = AdminReportResponseSchema.parse(
    await (await f.admin.http.raw('/api/v1/admin/reports/' + f.report.id)).json(),
  ).data;
  if (!detail.moderation.release) throw Error('真实版本举报缺少版本管理状态');
  const path = '/api/v1/me/personas/' + f.persona.id + '/releases/' + f.releaseId + '/state';
  for (const action of ['block', 'restore'])
    expect(
      (await f.admin.http.write(path, { action, reason: '真实状态往返并发验收' }, 'POST', nonce()))
        .status,
    ).toBe(200);
  const command: ReportResolution = {
    reason: '版本处置说明',
    content: { action: 'block_release', expectedRevision: detail.moderation.release.revision },
  };
  expect((await act(f.admin.http, f, command)).status).toBe(412);
  const fresh = AdminReportResponseSchema.parse(
    await (await f.admin.http.raw('/api/v1/admin/reports/' + f.report.id)).json(),
  ).data;
  if (!fresh.moderation.release) throw Error('重新读取的版本举报缺少版本管理状态');
  expect(fresh.status).toBe('pending');
  expect(fresh.moderation.release).toEqual({
    state: 'PUBLISHED',
    revision: detail.moderation.release.revision + 2,
  });
  if (!command.content) throw Error('缺少版本命令');
  command.content.expectedRevision = fresh.moderation.release.revision;
  expect((await act(f.admin.http, f, command)).status).toBe(200);
});

it.each(['pending', 'approved'] as const)(
  '评论处置只针对冻结的获批正文，后续%s改稿遵守版本隔离',
  async (mode) => {
    const f = await fixture();
    const created = await f.owner.http.write(
      '/api/v1/personas/' + f.persona.id + '/comments',
      { body: '已获批的举报目标正文' },
      'POST',
      nonce(),
    );
    expect(created.status).toBe(200);
    const comment = CommentResponseSchema.parse(await created.json()).data;
    const review = await f.admin.http.write(
      '/api/v1/admin/comments/' + comment.id + '/review',
      {
        revisionId: comment.latest.id,
        expectedRevision: comment.revision,
        decision: 'approve',
        reason: '',
      },
      'POST',
      nonce(),
    );
    expect(review.status).toBe(200);
    const approved = AdminCommentResponseSchema.parse(await review.json()).data;
    const reported = await f.reporter.http.write(
      '/api/v1/reports',
      {
        target: { type: 'comment', commentId: comment.id },
        reason: 'inappropriate',
        details: '仅举报人和管理员可见的线索',
      },
      'POST',
      nonce(),
    );
    expect(reported.status).toBe(200);
    const report = OwnReportResponseSchema.parse(await reported.json()).data;
    const edited = await f.owner.http.write(
      '/api/v1/comments/' + comment.id,
      { body: '后续新版正文，不能从旧举报泄漏', expectedRevision: approved.revision },
      'PATCH',
      nonce(),
    );
    expect(edited.status).toBe(200);
    let changed = CommentResponseSchema.parse(await edited.json()).data;
    if (mode === 'approved') {
      const revised = await f.admin.http.write(
        '/api/v1/admin/comments/' + comment.id + '/review',
        {
          revisionId: changed.latest.id,
          expectedRevision: changed.revision,
          decision: 'approve',
          reason: '',
        },
        'POST',
        nonce(),
      );
      expect(revised.status).toBe(200);
      changed = AdminCommentResponseSchema.parse(await revised.json()).data;
    }
    const command: ReportResolution = {
      reason: '被处置者可见的评论说明',
      content: { action: 'hide_comment', expectedRevision: changed.revision },
    };
    const result = await act(f.admin.http, { ...f, report }, command);
    expect(result.status).toBe(mode === 'pending' ? 200 : 412);
    const stored = (
      await stack.owner.pool.query('SELECT visibility FROM comments WHERE id=$1', [comment.id])
    ).rows[0];
    expect(stored?.visibility).toBe(mode === 'pending' ? 'hidden' : 'normal');
    const frozen = OwnReportResponseSchema.parse(
      await (await f.reporter.http.raw('/api/v1/me/reports/' + report.id)).json(),
    ).data;
    expect(frozen.snapshot).toEqual(report.snapshot);
    expect(JSON.stringify(frozen)).not.toContain('后续新版正文');
    expect(frozen.status).toBe(mode === 'pending' ? 'resolved' : 'pending');
    if (mode === 'pending') {
      const notices = (
        await stack.owner.pool.query(
          "SELECT n.message,n.target FROM notifications n JOIN report_actions a ON a.id=n.source_id WHERE a.report_id=$1 AND n.kind='report_updated'",
          [report.id],
        )
      ).rows;
      expect(notices).toEqual([
        { message: '举报人可见的结案说明', target: { type: 'own_report', reportId: report.id } },
      ]);
      expect(frozen.publicPath).toBeNull();
    }
  },
);

it('最后有效管理员不能通过举报自我封禁，先写入的内容处置和通知同时回滚', async () => {
  const f = await fixture();
  const adminId = (await f.admin.http.context()).data.account?.id;
  if (!adminId) throw Error('缺少管理员');
  const promoted = await f.admin.http.write(
    '/api/v1/admin/users/' + f.ownerId + '/role',
    {
      role: 'admin',
      reason: '隔离验收最后管理员保护',
      expectedSecurityVersion: f.user.securityVersion,
    },
    'PUT',
    nonce(),
  );
  expect(promoted.status).toBe(200);
  expect(
    (
      await f.owner.http.write('/api/v1/auth/login', {
        identifier: f.owner.username,
        password: f.owner.password,
      })
    ).status,
  ).toBe(200);
  const original = AdminUserResponseSchema.parse(
    await (await f.owner.http.raw('/api/v1/admin/users/' + adminId)).json(),
  ).data;
  expect(
    (
      await f.owner.http.write(
        '/api/v1/admin/users/' + adminId + '/role',
        {
          role: 'user',
          reason: '隔离验收保留一个管理员',
          expectedSecurityVersion: original.securityVersion,
        },
        'PUT',
        nonce(),
      )
    ).status,
  ).toBe(200);
  const detail = AdminReportResponseSchema.parse(
    await (await f.owner.http.raw('/api/v1/admin/reports/' + f.report.id)).json(),
  ).data;
  const command = resolution(f);
  if (!command.account) throw Error('缺少账号命令');
  command.account.expectedSecurityVersion = detail.moderation.account.securityVersion;
  const result = await f.owner.http.write(
    '/api/v1/admin/reports/' + f.report.id + '/actions',
    {
      action: 'resolve',
      message: '举报人可见说明',
      privateNote: '内部说明',
      confirmed: true,
      selfReviewConfirmed: true,
      resolution: command,
    },
    'POST',
    { 'Idempotency-Key': randomUUID(), 'If-Match': reportEtag(f.report.id, 1) },
  );
  expect(result.status).toBe(409);
  expect(ErrorResponseSchema.parse(await result.json()).error.code).toBe('CONFLICT');
  await expectUnchanged(f);
  const admins = (
    await stack.owner.pool.query(
      "SELECT count(*)::int AS count FROM users WHERE role='admin' AND status='active'",
    )
  ).rows;
  expect(admins).toEqual([{ count: 1 }]);
});
