import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  AssetResponseSchema,
  ProfileSubmissionResponseSchema,
  PublicCreatorResponseSchema,
  OwnProfileResponseSchema,
  OwnReportResponseSchema,
  AdminReportResponseSchema,
  OwnReportRecordsResponseSchema,
  reportEtag,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator } from '../fixtures/creator.js';
import { fixturePng } from '../fixtures/image.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
let owner: Awaited<ReturnType<typeof verifiedCreator>>;
let reporter: Awaited<ReturnType<typeof verifiedCreator>>;
let admin: Awaited<ReturnType<Awaited<ReturnType<typeof createAuthStack>>['admin']>>;
let userId: string;
let submissionId: string;
let avatarId: string;
const nonce = () => ({ 'Idempotency-Key': randomUUID() });
beforeEach(async () => {
  stack = await createAuthStack();
  owner = await verifiedCreator(stack);
  reporter = await verifiedCreator(stack);
  admin = await stack.admin();
  const context = await owner.http.context();
  if (!context.data.account) throw new Error('Missing controlled profile owner');
  userId = context.data.account.id;
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(fixturePng)], { type: 'image/png' }), 'fixture.png');
  const image = await fetch(owner.http.base + '/api/v1/me/assets/upload/avatar', {
    method: 'POST',
    headers: {
      Cookie: [...owner.http.cookies].map(([key, value]) => key + '=' + value).join('; '),
      Origin: owner.http.origin,
      'X-CSRF-Token': context.data.csrfToken,
    },
    body: form,
  });
  expect(image.status).toBe(200);
  avatarId = AssetResponseSchema.parse(await image.json()).data.id;
  expect(
    (
      await owner.http.write(
        '/api/v1/me/profile',
        {
          content: {
            displayName: '云',
            bio: '这是已经审核的公开资料',
            avatarAssetId: avatarId,
            links: [],
          },
          expectedRevision: 0,
        },
        'PUT',
      )
    ).status,
  ).toBe(200);
  const submitted = await owner.http.write(
    '/api/v1/me/profile/submissions',
    { expectedDraftRevision: 1, confirmed: true },
    'POST',
    nonce(),
  );
  expect(submitted.status).toBe(200);
  submissionId = ProfileSubmissionResponseSchema.parse(await submitted.json()).data.id;
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/profiles/submissions/' + submissionId + '/review',
        {
          decision: 'approve',
          expectedRevision: 1,
          reason: '核验公开资料',
          selfReviewConfirmed: false,
        },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(200);
});
afterEach(async () => {
  await stack?.close();
});

it('资料举报的数据库引用不可变，空作品引用不能绕过旧类型约束，跨作者快照不能混入', async () => {
  const report = await createReport();
  await expect(
    stack.owner.pool.query(
      'UPDATE reports SET profile_submission_id=$1,revision=revision+1 WHERE id=$2',
      [randomUUID(), report.id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  const reporterId = (await reporter.http.context()).data.account?.id;
  if (!reporterId) throw new Error('Missing actual reporter account');
  const clone = `INSERT INTO reports
    (id,reporter_id,reported_user_id,type,target_id,target_revision_id,persona_id,release_id,
      profile_user_id,profile_submission_id,target_title,reason,details,snapshot,content_hash,status,updated_by)
    SELECT $1,reporter_id,reported_user_id,$2::text,target_id,target_revision_id,NULL,NULL,
      $3,$4,'复核',reason,details,
      jsonb_set(jsonb_set(snapshot,'{type}',to_jsonb($2::text)),'{title}','"复核"'::jsonb),
      content_hash,'resolved',updated_by FROM reports WHERE id=$5`;
  // persona/comment 现在可空的FK必须显式拒绝缺少作品引用，SQL UNKNOWN不能被当成通过
  for (const type of ['persona', 'comment'])
    await expect(
      stack.owner.pool.query(clone, [randomUUID(), type, null, null, report.id]),
    ).rejects.toMatchObject({ code: '23514', constraint: 'reports_target_shape' });
  await expect(
    stack.owner.pool.query(
      `INSERT INTO reports
      (reporter_id,reported_user_id,type,target_id,target_revision_id,profile_user_id,profile_submission_id,
        target_title,reason,snapshot,content_hash,status,updated_by)
      SELECT reporter_id,$1,'profile',$1,target_revision_id,$1,profile_submission_id,
        target_title,reason,snapshot,content_hash,'resolved',updated_by FROM reports WHERE id=$2`,
      [reporterId, report.id],
    ),
  ).rejects.toMatchObject({ code: '23503', constraint: 'reports_profile_submission_owner_fk' });
  expect(
    (await stack.owner.pool.query('SELECT count(*)::int AS count FROM reports')).rows[0]?.count,
  ).toBe(1);
  expect(
    (
      await stack.owner.pool.query('SELECT profile_submission_id FROM reports WHERE id=$1', [
        report.id,
      ])
    ).rows[0]?.profile_submission_id,
  ).toBe(submissionId);
});
async function createReport() {
  const response = await reporter.http.write(
    '/api/v1/reports',
    {
      target: { type: 'profile', userId, submissionId },
      reason: 'inappropriate',
      details: '仅举报人和管理员可见的补充说明',
    },
    'POST',
    nonce(),
  );
  expect(response.status).toBe(200);
  return OwnReportResponseSchema.parse(await response.json()).data;
}
async function resolution(reportId: string) {
  const detail = AdminReportResponseSchema.parse(
    await (await admin.http.raw('/api/v1/admin/reports/' + reportId)).json(),
  ).data;
  if (!detail.moderation.profile) throw new Error('Missing actual profile moderation state');
  return {
    detail,
    command: {
      action: 'resolve',
      message: '举报已核验并处理',
      privateNote: 'ADMIN_PRIVATE_NOTE_NEVER_SHARED',
      selfReviewConfirmed: false,
      confirmed: true,
      resolution: {
        reason: '资料内容需要调整，暂时隐藏公开资料',
        content: { action: 'hide_profile', expectedRevision: detail.moderation.profile.revision },
      },
    },
  };
}

it('公开资料举报冻结获批快照和头像，结案处置同事务隐藏资料且双方说明隔离', async () => {
  const report = await createReport();
  expect(report.snapshot.type).toBe('profile');
  if (report.snapshot.type !== 'profile') throw new Error('Wrong real report snapshot');
  expect(report.snapshot.profile.submissionId).toBe(submissionId);
  expect(report.snapshot.profile.content.displayName).toBe('云');
  expect(report.personaId).toBeNull();
  expect(report.platform).toBeNull();
  expect(report.version).toBeNull();
  const evidence = '/api/v1/me/reports/' + report.id + '/avatar';
  expect((await stack.browser().raw(evidence)).status).toBe(401);
  expect((await owner.http.raw(evidence)).status).toBe(404);
  expect((await reporter.http.raw(evidence)).status).toBe(200);
  const { detail, command } = await resolution(report.id),
    endpoint = '/api/v1/admin/reports/' + report.id + '/actions';
  expect(
    (
      await admin.http.write(endpoint, command, 'POST', {
        ...nonce(),
        'If-Match': reportEtag(report.id, detail.revision),
      })
    ).status,
  ).toBe(200);
  expect(
    OwnProfileResponseSchema.parse(await (await owner.http.raw('/api/v1/me/profile')).json()).data
      .visibility,
  ).toBe('hidden');
  const anonymous = stack.browser(),
    publicProfile = PublicCreatorResponseSchema.parse(
      await (await anonymous.raw('/api/v1/users/' + owner.username)).json(),
    ).data;
  expect(publicProfile.displayName).toBe(owner.username);
  expect(publicProfile.bio).toBe('');
  expect(publicProfile.avatarUrl).toBeNull();
  expect(
    (await anonymous.raw('/api/v1/users/' + owner.username + '/avatar/' + submissionId)).status,
  ).toBe(404);
  const frozen = await reporter.http.raw(evidence);
  expect(frozen.status).toBe(200);
  expect(frozen.headers.get('cache-control')).toContain('no-store');
  const own = OwnReportResponseSchema.parse(
    await (await reporter.http.raw('/api/v1/me/reports/' + report.id)).json(),
  ).data;
  expect(own.status).toBe('resolved');
  expect(own.publicPath).toBeNull();
  const records = OwnReportRecordsResponseSchema.parse(
    await (await reporter.http.raw('/api/v1/me/reports/' + report.id + '/records')).json(),
  );
  expect(records.data.some((record) => record.resolution?.content === 'hide_profile')).toBe(true);
  expect(JSON.stringify(records)).not.toContain('ADMIN_PRIVATE_NOTE_NEVER_SHARED');
  expect(JSON.stringify(records)).not.toContain('资料内容需要调整，暂时隐藏公开资料');
  expect((await owner.http.raw('/api/v1/me/reports/' + report.id)).status).toBe(404);
  const notified = await stack.owner.pool.query<{ amount: number }>(
    "SELECT count(*)::int AS amount FROM notifications WHERE source_id IN (SELECT id FROM profile_records WHERE user_id=$1 AND action='hide') AND recipient_id=$1 AND kind='profile_state'",
    [userId],
  );
  expect(notified.rows[0]?.amount).toBe(1);
});

it('待审或错配资料不能举报，旧举报不能越过获批快照边界下架新资料', async () => {
  expect(
    (
      await owner.http.write(
        '/api/v1/me/profile',
        {
          content: {
            displayName: '新获批资料',
            bio: '这份更新正在审核',
            avatarAssetId: avatarId,
            links: [],
          },
          expectedRevision: 1,
        },
        'PUT',
      )
    ).status,
  ).toBe(200);
  const pendingResponse = await owner.http.write(
    '/api/v1/me/profile/submissions',
    { expectedDraftRevision: 2, confirmed: true },
    'POST',
    nonce(),
  );
  expect(pendingResponse.status).toBe(200);
  const pending = ProfileSubmissionResponseSchema.parse(await pendingResponse.json()).data;
  expect(
    (
      await reporter.http.write(
        '/api/v1/reports',
        {
          target: { type: 'profile', userId, submissionId: pending.id },
          reason: 'other',
          details: '',
        },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await reporter.http.write(
        '/api/v1/reports',
        {
          target: { type: 'profile', userId: randomUUID(), submissionId },
          reason: 'other',
          details: '',
        },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(404);
  const report = await createReport();
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/profiles/submissions/' + pending.id + '/review',
        {
          decision: 'approve',
          expectedRevision: pending.revision,
          reason: '新版审核通过',
          selfReviewConfirmed: false,
        },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(200);
  const { detail, command } = await resolution(report.id);
  expect(
    (
      await admin.http.write('/api/v1/admin/reports/' + report.id + '/actions', command, 'POST', {
        ...nonce(),
        'If-Match': reportEtag(report.id, detail.revision),
      })
    ).status,
  ).toBe(412);
  expect(
    OwnReportResponseSchema.parse(
      await (await reporter.http.raw('/api/v1/me/reports/' + report.id)).json(),
    ).data.status,
  ).toBe('pending');
  const published = PublicCreatorResponseSchema.parse(
    await (await stack.browser().raw('/api/v1/users/' + owner.username)).json(),
  ).data;
  expect(published.displayName).toBe('新获批资料');
  expect(published.approvedRevisionId).toBe(pending.id);
});

it('资料举报处置通知故障回滚全部结果，并发管理员提交只有一份处置凭据', async () => {
  const report = await createReport(),
    { detail, command } = await resolution(report.id),
    endpoint = '/api/v1/admin/reports/' + report.id + '/actions';
  await stack.owner.pool
    .query(`CREATE FUNCTION public.reject_profile_report_outbox_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.topic='notification.deliver' THEN RAISE EXCEPTION 'CONTROLLED_PROFILE_REPORT_FAILURE'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_profile_report_outbox_fixture BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION public.reject_profile_report_outbox_fixture()`);
  try {
    expect(
      (
        await admin.http.write(endpoint, command, 'POST', {
          ...nonce(),
          'If-Match': reportEtag(report.id, detail.revision),
        })
      ).status,
    ).toBe(500);
    expect(
      OwnProfileResponseSchema.parse(await (await owner.http.raw('/api/v1/me/profile')).json()).data
        .visibility,
    ).toBe('normal');
    expect(
      OwnReportResponseSchema.parse(
        await (await reporter.http.raw('/api/v1/me/reports/' + report.id)).json(),
      ).data.status,
    ).toBe('pending');
  } finally {
    await stack.owner.pool.query(
      'DROP TRIGGER reject_profile_report_outbox_fixture ON outbox_events; DROP FUNCTION public.reject_profile_report_outbox_fixture()',
    );
  }
  const responses = await Promise.all(
    [0, 1].map(() =>
      admin.http.write(endpoint, command, 'POST', {
        ...nonce(),
        'If-Match': reportEtag(report.id, detail.revision),
      }),
    ),
  );
  expect(responses.map((response) => response.status).sort()).toEqual([200, 412]);
  const receipts = await stack.owner.pool.query<{ amount: number }>(
    'SELECT count(*)::int AS amount FROM report_resolutions r JOIN report_actions a ON a.id=r.action_id WHERE a.report_id=$1',
    [report.id],
  );
  expect(receipts.rows[0]?.amount).toBe(1);
  const hidden = await stack.owner.pool.query<{ amount: number }>(
    "SELECT count(*)::int AS amount FROM profile_records WHERE user_id=$1 AND action='hide'",
    [userId],
  );
  expect(hidden.rows[0]?.amount).toBe(1);
});
