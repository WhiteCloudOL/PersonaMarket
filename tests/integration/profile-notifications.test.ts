import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  NotificationsResponseSchema,
  ProfileSubmissionResponseSchema,
  ProfileVisibilityResponseSchema,
  OwnProfileResponseSchema,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator } from '../fixtures/creator.js';
import type { AuthHttp } from '../fixtures/auth-http.js';
import { mailText } from '../fixtures/mailpit.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});
const nonce = () => ({ 'Idempotency-Key': randomUUID() });
const ownRoute = '/api/v1/me/profile';
const content = {
  displayName: '通知资料作者',
  bio: '待审资料不会提前通知其他人',
  avatarAssetId: null,
  links: [],
};
async function prepare(http: AuthHttp) {
  expect((await http.write(ownRoute, { content, expectedRevision: 0 }, 'PUT')).status).toBe(200);
  return submit(http, 1);
}
async function submit(http: AuthHttp, revision: number) {
  const response = await http.write(
    ownRoute + '/submissions',
    { expectedDraftRevision: revision, confirmed: true },
    'POST',
    nonce(),
  );
  expect(response.status).toBe(200);
  return ProfileSubmissionResponseSchema.parse(await response.json()).data;
}
const reviewRoute = (id: string) => '/api/v1/admin/profiles/submissions/' + id + '/review';

it('资料审核和下架状态同事务入队，Worker只向本人送达并且幂等重放不重复通知', async () => {
  const creator = await verifiedCreator(stack),
    admin = await stack.admin(),
    first = await prepare(creator.http),
    account = (await creator.http.context()).data.account;
  if (!account) throw new Error('Missing controlled creator');
  const count = async () =>
    (
      await stack.owner.pool.query<{ amount: number }>(
        "SELECT count(*)::int AS amount FROM notifications WHERE recipient_id=$1 AND kind LIKE 'profile_%'",
        [account.id],
      )
    ).rows[0]?.amount;
  expect(await count()).toBe(0);
  const key = nonce(),
    approved = {
      decision: 'approve',
      expectedRevision: 1,
      reason: '公开资料已核验',
      selfReviewConfirmed: false,
    };
  expect((await admin.http.write(reviewRoute(first.id), approved, 'POST', key)).status).toBe(200);
  expect(await count()).toBe(1);
  expect((await admin.http.write(reviewRoute(first.id), approved, 'POST', key)).status).toBe(200);
  expect(await count()).toBe(1);
  expect(
    (
      await creator.http.write(
        ownRoute,
        { content: { ...content, bio: '第二份资料尚未通过' }, expectedRevision: 1 },
        'PUT',
      )
    ).status,
  ).toBe(200);
  const second = await submit(creator.http, 2);
  expect(await count()).toBe(1);
  expect(
    (
      await admin.http.write(
        reviewRoute(second.id),
        {
          decision: 'reject',
          expectedRevision: 1,
          reason: '请补充资料来源说明',
          selfReviewConfirmed: false,
        },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(200);
  const beforeHide = OwnProfileResponseSchema.parse(
    await (await creator.http.raw(ownRoute)).json(),
  ).data;
  const endpoint = '/api/v1/admin/profiles/' + account.id + '/visibility';
  const hidden = await admin.http.write(
    endpoint,
    {
      hidden: true,
      expectedRevision: beforeHide.moderationRevision,
      reason: '需核对公开资料',
      selfReviewConfirmed: false,
    },
    'POST',
    nonce(),
  );
  expect(hidden.status).toBe(200);
  const state = ProfileVisibilityResponseSchema.parse(await hidden.json()).data;
  expect(
    (
      await admin.http.write(
        endpoint,
        {
          hidden: false,
          expectedRevision: state.revision,
          reason: '已完成核对',
          selfReviewConfirmed: false,
        },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(200);
  expect(await count()).toBe(4);
  await expect
    .poll(async () => {
      await stack.tick();
      const response = NotificationsResponseSchema.parse(
        await (await creator.http.raw('/api/v1/me/notifications')).json(),
      );
      return response.data.filter((entry) => entry.kind.startsWith('profile_')).length;
    })
    .toBe(4);
  const inbox = NotificationsResponseSchema.parse(
    await (await creator.http.raw('/api/v1/me/notifications')).json(),
  );
  const notices = inbox.data.filter((entry) => entry.kind.startsWith('profile_'));
  expect(notices.map((entry) => entry.kind).sort()).toEqual([
    'profile_approved',
    'profile_rejected',
    'profile_state',
    'profile_state',
  ]);
  for (const notice of notices) {
    expect(notice.available).toBe(true);
    expect(notice.path).toBe('/dashboard/profile');
  }
  const adminInbox = NotificationsResponseSchema.parse(
    await (await admin.http.raw('/api/v1/me/notifications')).json(),
  );
  expect(adminInbox.data.filter((entry) => entry.kind.startsWith('profile_'))).toEqual([]);
});

it('资料审核的通知Outbox插入失败会回滚快照状态、公开指针、审计、记录和幂等凭据', async () => {
  const creator = await verifiedCreator(stack),
    admin = await stack.admin(),
    first = await prepare(creator.http);
  const key = nonce(),
    command = {
      decision: 'approve',
      expectedRevision: 1,
      reason: '测试真实事务失败回滚',
      selfReviewConfirmed: false,
    };
  const before = OwnProfileResponseSchema.parse(await (await creator.http.raw(ownRoute)).json());
  await stack.owner.pool
    .query(`CREATE FUNCTION public.reject_profile_outbox_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.topic='notification.deliver' THEN RAISE EXCEPTION 'CONTROLLED_PROFILE_OUTBOX_FAILURE'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_profile_outbox_fixture BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION public.reject_profile_outbox_fixture()`);
  try {
    expect((await admin.http.write(reviewRoute(first.id), command, 'POST', key)).status).toBe(500);
    expect(OwnProfileResponseSchema.parse(await (await creator.http.raw(ownRoute)).json())).toEqual(
      before,
    );
    const records = await stack.owner.pool.query<{ amount: number }>(
      "SELECT count(*)::int AS amount FROM profile_records WHERE submission_id=$1 AND action='approve'",
      [first.id],
    );
    expect(records.rows[0]?.amount).toBe(0);
    const receipts = await stack.owner.pool.query<{ amount: number }>(
      "SELECT count(*)::int AS amount FROM idempotency_keys WHERE operation='profile.review' AND key=$1",
      [key['Idempotency-Key']],
    );
    expect(receipts.rows[0]?.amount).toBe(0);
  } finally {
    await stack.owner.pool.query(
      'DROP TRIGGER reject_profile_outbox_fixture ON outbox_events; DROP FUNCTION public.reject_profile_outbox_fixture()',
    );
  }
  expect((await admin.http.write(reviewRoute(first.id), command, 'POST', key)).status).toBe(200);
  const records = await stack.owner.pool.query<{ amount: number }>(
    "SELECT count(*)::int AS amount FROM profile_records WHERE submission_id=$1 AND action='approve'",
    [first.id],
  );
  expect(records.rows[0]?.amount).toBe(1);
});

it('资料提交和审核邮件真实送达，关闭审核邮件偏好后站内结果仍送达', async () => {
  const creator = await verifiedCreator(stack),
    admin = await stack.admin(),
    first = await prepare(creator.http);
  await mailText(creator.email, '个人资料已提交审核', stack.tick);
  expect(
    (
      await admin.http.write(
        reviewRoute(first.id),
        {
          decision: 'approve',
          expectedRevision: 1,
          reason: '资料邮件验收首版通过',
          selfReviewConfirmed: false,
        },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(200);
  await mailText(creator.email, '资料邮件验收首版通过', stack.tick);
  expect(
    (
      await creator.http.write(
        '/api/v1/me/notifications/preferences',
        { reviewEmail: false, expectedRevision: 0 },
        'PATCH',
      )
    ).status,
  ).toBe(200);
  const mailCount = async () =>
    (
      await stack.owner.pool.query<{ amount: number }>(
        "SELECT count(*)::int AS amount FROM outbox_events WHERE topic='auth.email'",
      )
    ).rows[0]?.amount;
  const before = await mailCount();
  expect(
    (
      await creator.http.write(
        ownRoute,
        { content: { ...content, bio: '关闭邮件后提交新版' }, expectedRevision: 1 },
        'PUT',
      )
    ).status,
  ).toBe(200);
  const second = await submit(creator.http, 2);
  expect(
    (
      await admin.http.write(
        reviewRoute(second.id),
        {
          decision: 'reject',
          expectedRevision: 1,
          reason: '审核邮件关闭后仍有站内退回提醒',
          selfReviewConfirmed: false,
        },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(200);
  expect(await mailCount()).toBe(before);
  await expect
    .poll(async () => {
      await stack.tick();
      const inbox = NotificationsResponseSchema.parse(
        await (await creator.http.raw('/api/v1/me/notifications')).json(),
      );
      return inbox.data.some(
        (entry) =>
          entry.kind === 'profile_rejected' && entry.message === '审核邮件关闭后仍有站内退回提醒',
      );
    })
    .toBe(true);
});
