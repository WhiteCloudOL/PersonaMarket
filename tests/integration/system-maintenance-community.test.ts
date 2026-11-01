import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  AdminNoticeResponseSchema,
  AdminReportResponseSchema,
  CommentActionResponseSchema,
  CommentResponseSchema,
  FavoritesResponseSchema,
  NotificationCountResponseSchema,
  NotificationPreferencesResponseSchema,
  NotificationReadResponseSchema,
  NotificationsResponseSchema,
  OwnInteractionsResponseSchema,
  OwnProfileResponseSchema,
  OwnReportResponseSchema,
  ProfileSubmissionResponseSchema,
  PublicCreatorResponseSchema,
  PublicReleaseResponseSchema,
  SubmissionResponseSchema,
  reportEtag,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import type { AuthHttp } from '../fixtures/auth-http.js';
import { completePersona, verifiedCreator } from '../fixtures/creator.js';
import { expectMaintenance, setMaintenance } from '../fixtures/system-maintenance.js';

// 只用隔离真实API/PG/Redis/Mailpit与正常业务命令，不操作基础设施故障或锁探针。
let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});
const nonce = () => ({ 'Idempotency-Key': randomUUID() });
const tables = {
  relations: ['persona_likes', 'persona_favorites'],
  comments: ['comments', 'comment_revisions', 'comment_moderation_records'],
  profiles: ['user_profiles', 'profile_drafts', 'profile_submissions', 'profile_records'],
  reports: ['reports', 'report_actions'],
} as const;

async function effects(prefix: string) {
  // Worker可更新投递元数据；只比较稳定的Outbox身份/payload，不将合法消费误判为普通写。
  const result = await stack.owner.pool.query<{ data: unknown }>(
    `SELECT jsonb_build_object(
    'idem',(SELECT md5(COALESCE(jsonb_agg(to_jsonb(k) ORDER BY k.actor_id,k.operation,k.key),'[]'::jsonb)::text)
      FROM idempotency_keys k WHERE k.operation LIKE $1),
    'audit',(SELECT count(*) FROM auth_audit_events WHERE event LIKE $1),
    'outbox',(SELECT md5(COALESCE(jsonb_agg(jsonb_build_array(id,topic,payload) ORDER BY id),'[]'::jsonb)::text) FROM outbox_events)
  ) AS data`,
    [prefix + '.%'],
  );
  return result.rows[0]?.data;
}
async function facts(kind: keyof typeof tables) {
  const result: Record<string, unknown> = {};
  // 标识符仅来自上方模块内固定白名单，不来自HTTP或测试数据。
  for (const table of tables[kind]) {
    const rows = await stack.owner.pool.query<{ digest: string }>(
      `SELECT md5(COALESCE(jsonb_agg(to_jsonb(recorded) ORDER BY to_jsonb(recorded)::text),'[]'::jsonb)::text) AS digest FROM public.${table} recorded`,
    );
    result[table] = rows.rows[0]?.digest;
  }
  result['effects'] = await effects(kind === 'relations' ? 'interaction' : kind.slice(0, -1));
  return result;
}
async function publish(owner: AuthHttp, admin: AuthHttp) {
  const persona = await completePersona(owner);
  const response = await owner.write(
    '/api/v1/me/personas/' + persona.id + '/releases',
    {
      version: '1.0.0',
      expectedDraftRevision: persona.revision,
      changelog: '维护模式正常社区业务核对',
      confirmed: true,
    },
    'POST',
    nonce(),
  );
  expect(response.status).toBe(200);
  const submission = SubmissionResponseSchema.parse(await response.json()).data;
  const reviewed = await admin.write(
    '/api/v1/admin/moderation/submissions/' + submission.id + '/review',
    {
      action: 'approve',
      expectedRevision: submission.revision,
      reason: '核实正常社区作品',
      selfReviewConfirmed: false,
    },
    'POST',
    nonce(),
  );
  expect(reviewed.status).toBe(200);
  return persona;
}
async function ownComment(response: Response) {
  expect(response.status).toBe(200);
  return CommentResponseSchema.parse(await response.json()).data;
}
const profilePath = '/api/v1/me/profile';
const profileContent = {
  displayName: '维护核对创作者',
  bio: '本人正常公开介绍',
  avatarAssetId: null,
  links: [],
};
async function submitProfile(http: AuthHttp, expectedDraftRevision: number, key = nonce()) {
  const input = { expectedDraftRevision, confirmed: true };
  const response = await http.write(profilePath + '/submissions', input, 'POST', key);
  expect(response.status).toBe(200);
  return { input, key, data: ProfileSubmissionResponseSchema.parse(await response.json()).data };
}
async function approveProfile(admin: AuthHttp, id: string, revision: number) {
  const response = await admin.write(
    '/api/v1/admin/profiles/submissions/' + id + '/review',
    {
      decision: 'approve',
      expectedRevision: revision,
      reason: '核实他人正常公开资料',
      selfReviewConfirmed: false,
    },
    'POST',
    nonce(),
  );
  expect(response.status).toBe(200);
}

it('维护拒绝普通账号与管理员创作者点赞/收藏加减，关系不变且读取继续，关闭后明确重试', async () => {
  const author = await verifiedCreator(stack),
    viewer = await verifiedCreator(stack),
    admin = await stack.admin();
  const existing = await publish(author.http, admin.http),
    fresh = await publish(author.http, admin.http);
  for (const http of [viewer.http, admin.http]) {
    for (const kind of ['like', 'favorite']) {
      expect(
        (await http.write('/api/v1/personas/' + existing.id + '/' + kind, {}, 'PUT')).status,
      ).toBe(200);
    }
  }
  await setMaintenance(admin.http, true);
  const before = await facts('relations');
  for (const http of [viewer.http, admin.http]) {
    for (const kind of ['like', 'favorite']) {
      await expectMaintenance(
        await http.write('/api/v1/personas/' + fresh.id + '/' + kind, {}, 'PUT'),
      );
      await expectMaintenance(
        await http.write('/api/v1/personas/' + existing.id + '/' + kind, {}, 'DELETE'),
      );
    }
    const state = await http.raw(
      '/api/v1/me/persona-interactions?ids=' + existing.id + ',' + fresh.id,
    );
    expect(state.status).toBe(200);
    const states = OwnInteractionsResponseSchema.parse(await state.json()).data;
    expect(states).toContainEqual(
      expect.objectContaining({ personaId: existing.id, liked: true, favorited: true }),
    );
    expect(states).toContainEqual(
      expect.objectContaining({ personaId: fresh.id, liked: false, favorited: false }),
    );
    const favorites = await http.raw('/api/v1/me/favorites');
    expect(favorites.status).toBe(200);
    expect(FavoritesResponseSchema.parse(await favorites.json()).meta.total).toBe(1);
  }
  const publicResponse = await stack.browser().raw('/api/v1/personas/' + existing.id);
  expect(publicResponse.status).toBe(200);
  expect(
    PublicReleaseResponseSchema.parse(await publicResponse.json()).data.interactionCounts,
  ).toEqual({ likes: 2, favorites: 2 });
  expect(await facts('relations')).toEqual(before);
  await setMaintenance(admin.http, false);
  for (const http of [viewer.http, admin.http]) {
    for (const kind of ['like', 'favorite']) {
      expect(
        (await http.write('/api/v1/personas/' + existing.id + '/' + kind, {}, 'DELETE')).status,
      ).toBe(200);
      expect(
        (await http.write('/api/v1/personas/' + fresh.id + '/' + kind, {}, 'PUT')).status,
      ).toBe(200);
    }
  }
  expect(
    PublicReleaseResponseSchema.parse(
      await (await stack.browser().raw('/api/v1/personas/' + existing.id)).json(),
    ).data.interactionCounts,
  ).toEqual({ likes: 0, favorites: 0 });
  expect(
    PublicReleaseResponseSchema.parse(
      await (await stack.browser().raw('/api/v1/personas/' + fresh.id)).json(),
    ).data.interactionCounts,
  ).toEqual({ likes: 2, favorites: 2 });
});

it('评论新建/编辑/删除拒绝，原成功create/edit/delete key只读核对不增记录，恢复后原候选可写', async () => {
  const author = await verifiedCreator(stack),
    writer = await verifiedCreator(stack),
    admin = await stack.admin();
  const persona = await publish(author.http, admin.http),
    path = '/api/v1/personas/' + persona.id + '/comments';
  const createKey = nonce(),
    createInput = { body: '第一份正常讨论内容' };
  const created = await ownComment(await writer.http.write(path, createInput, 'POST', createKey));
  const editKey = nonce(),
    editInput = { body: '已明确保存的第二份讨论内容', expectedRevision: created.revision };
  const edited = await ownComment(
    await writer.http.write('/api/v1/comments/' + created.id, editInput, 'PATCH', editKey),
  );
  const deletable = await ownComment(
    await writer.http.write(path, { body: '本人准备撤除的另一条正常讨论' }, 'POST', nonce()),
  );
  const deleteKey = nonce(),
    deleteInput = { expectedRevision: deletable.revision };
  const deletedResponse = await writer.http.write(
    '/api/v1/comments/' + deletable.id,
    deleteInput,
    'DELETE',
    deleteKey,
  );
  expect(deletedResponse.status).toBe(200);
  const deleted = CommentActionResponseSchema.parse(await deletedResponse.json());
  await setMaintenance(admin.http, true);
  const before = await facts('comments');
  const candidate = { body: '维护期间保留的新编辑候选', expectedRevision: edited.revision };
  await expectMaintenance(
    await writer.http.write(path, { body: '维护期间的新讨论候选' }, 'POST', nonce()),
  );
  await expectMaintenance(
    await writer.http.write('/api/v1/comments/' + edited.id, candidate, 'PATCH', nonce()),
  );
  await expectMaintenance(
    await writer.http.write(
      '/api/v1/comments/' + edited.id,
      { expectedRevision: edited.revision },
      'DELETE',
      nonce(),
    ),
  );
  expect((await ownComment(await writer.http.write(path, createInput, 'POST', createKey))).id).toBe(
    edited.id,
  );
  expect(
    await ownComment(
      await writer.http.write('/api/v1/comments/' + edited.id, editInput, 'PATCH', editKey),
    ),
  ).toEqual(edited);
  const deletedReplay = await writer.http.write(
    '/api/v1/comments/' + deletable.id,
    deleteInput,
    'DELETE',
    deleteKey,
  );
  expect(deletedReplay.status).toBe(200);
  expect(CommentActionResponseSchema.parse(await deletedReplay.json())).toEqual(deleted);
  expect((await writer.http.raw('/api/v1/me/comments/' + edited.id)).status).toBe(200);
  expect((await stack.browser().raw(path)).status).toBe(200);
  expect(await facts('comments')).toEqual(before);
  await setMaintenance(admin.http, false);
  const restored = await ownComment(
    await writer.http.write('/api/v1/comments/' + edited.id, candidate, 'PATCH', nonce()),
  );
  const remove = await writer.http.write(
    '/api/v1/comments/' + edited.id,
    { expectedRevision: restored.revision },
    'DELETE',
    nonce(),
  );
  expect(remove.status).toBe(200);
  expect(CommentActionResponseSchema.parse(await remove.json()).data.visibility).toBe('deleted');
  expect(
    (
      await ownComment(
        await writer.http.write(path, { body: '维护结束后明确创建的新讨论' }, 'POST', nonce()),
      )
    ).latest.body,
  ).toBe('维护结束后明确创建的新讨论');
});

it('资料保存/送审/撤回拒绝且不建档不换公开快照，原成功请求可核对，他人管理审核与关闭后恢复可用', async () => {
  const author = await verifiedCreator(stack),
    untouched = await verifiedCreator(stack),
    admin = await stack.admin();
  expect(
    (await author.http.write(profilePath, { content: profileContent, expectedRevision: 0 }, 'PUT'))
      .status,
  ).toBe(200);
  const approved = await submitProfile(author.http, 1);
  await approveProfile(admin.http, approved.data.id, approved.data.revision);
  const publicPath = '/api/v1/users/' + author.username;
  const published = PublicCreatorResponseSchema.parse(
    await (await stack.browser().raw(publicPath)).json(),
  );
  const nextContent = {
    ...profileContent,
    displayName: '下一份待审创作者介绍',
    bio: '尚未公开的私有候选',
  };
  expect(
    (await author.http.write(profilePath, { content: nextContent, expectedRevision: 1 }, 'PUT'))
      .status,
  ).toBe(200);
  const withdrawnSubmission = await submitProfile(author.http, 2),
    withdrawalKey = nonce();
  const withdrawal = { expectedRevision: withdrawnSubmission.data.revision, confirmed: true };
  const withdrawnResponse = await author.http.write(
    profilePath + '/submissions/' + withdrawnSubmission.data.id + '/withdraw',
    withdrawal,
    'POST',
    withdrawalKey,
  );
  expect(withdrawnResponse.status).toBe(200);
  const withdrawn = ProfileSubmissionResponseSchema.parse(await withdrawnResponse.json());
  const pending = await submitProfile(author.http, 2);
  const freshOwn = OwnProfileResponseSchema.parse(
    await (await untouched.http.raw(profilePath)).json(),
  );
  expect(freshOwn.data.revision).toBe(0);
  await setMaintenance(admin.http, true);
  const before = await facts('profiles');
  await expectMaintenance(
    await untouched.http.write(
      profilePath,
      { content: profileContent, expectedRevision: 0 },
      'PUT',
    ),
  );
  await expectMaintenance(
    await author.http.write(
      profilePath,
      { content: { ...nextContent, bio: '维护期间的新私有输入' }, expectedRevision: 2 },
      'PUT',
    ),
  );
  await expectMaintenance(
    await author.http.write(
      profilePath + '/submissions',
      { expectedDraftRevision: 2, confirmed: true },
      'POST',
      nonce(),
    ),
  );
  await expectMaintenance(
    await author.http.write(
      profilePath + '/submissions/' + pending.data.id + '/withdraw',
      { expectedRevision: pending.data.revision, confirmed: true },
      'POST',
      nonce(),
    ),
  );
  const submitReplay = await author.http.write(
    profilePath + '/submissions',
    withdrawnSubmission.input,
    'POST',
    withdrawnSubmission.key,
  );
  expect(submitReplay.status).toBe(200);
  expect(ProfileSubmissionResponseSchema.parse(await submitReplay.json())).toEqual(withdrawn);
  const withdrawalReplay = await author.http.write(
    profilePath + '/submissions/' + withdrawnSubmission.data.id + '/withdraw',
    withdrawal,
    'POST',
    withdrawalKey,
  );
  expect(withdrawalReplay.status).toBe(200);
  expect(ProfileSubmissionResponseSchema.parse(await withdrawalReplay.json())).toEqual(withdrawn);
  const pendingReplay = await author.http.write(
    profilePath + '/submissions',
    pending.input,
    'POST',
    pending.key,
  );
  expect(pendingReplay.status).toBe(200);
  expect(ProfileSubmissionResponseSchema.parse(await pendingReplay.json()).data).toEqual(
    pending.data,
  );
  expect(
    PublicCreatorResponseSchema.parse(await (await stack.browser().raw(publicPath)).json()),
  ).toEqual(published);
  expect(
    OwnProfileResponseSchema.parse(await (await untouched.http.raw(profilePath)).json()),
  ).toEqual(freshOwn);
  expect(await facts('profiles')).toEqual(before);
  await approveProfile(admin.http, pending.data.id, pending.data.revision);
  const reviewed = PublicCreatorResponseSchema.parse(
    await (await stack.browser().raw(publicPath)).json(),
  ).data;
  expect(reviewed.approvedRevisionId).toBe(pending.data.id);
  expect(reviewed.displayName).toBe(nextContent.displayName);
  await setMaintenance(admin.http, false);
  expect(
    (
      await untouched.http.write(
        profilePath,
        { content: profileContent, expectedRevision: 0 },
        'PUT',
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await author.http.write(
        profilePath,
        { content: { ...nextContent, bio: '恢复后明确保存的输入' }, expectedRevision: 2 },
        'PUT',
      )
    ).status,
  ).toBe(200);
  const restored = await submitProfile(author.http, 3);
  expect(
    (
      await author.http.write(
        profilePath + '/submissions/' + restored.data.id + '/withdraw',
        { expectedRevision: restored.data.revision, confirmed: true },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(200);
});

it('维护拒绝另一有效目标的新举报且不产生report/action/Outbox，关闭后原candidate/key可明确重试', async () => {
  const author = await verifiedCreator(stack),
    reporter = await verifiedCreator(stack),
    admin = await stack.admin();
  const first = await publish(author.http, admin.http),
    next = await publish(author.http, admin.http);
  const input = {
    target: { type: 'persona', personaId: first.id },
    reason: 'other',
    details: '希望核对这份正常公开作品的来源说明',
  };
  const key = nonce();
  const initial = await reporter.http.write('/api/v1/reports', input, 'POST', key);
  expect(initial.status).toBe(200);
  const report = OwnReportResponseSchema.parse(await initial.json()).data;
  const candidate = { ...input, target: { type: 'persona', personaId: next.id } },
    candidateKey = nonce();
  await setMaintenance(admin.http, true);
  const before = await facts('reports');
  await expectMaintenance(
    await reporter.http.write('/api/v1/reports', candidate, 'POST', candidateKey),
  );
  expect((await reporter.http.raw('/api/v1/me/reports/' + report.id)).status).toBe(200);
  expect(await facts('reports')).toEqual(before);
  await setMaintenance(admin.http, false);
  const restored = await reporter.http.write('/api/v1/reports', candidate, 'POST', candidateKey);
  expect(restored.status).toBe(200);
  const created = OwnReportResponseSchema.parse(await restored.json()).data;
  expect(created.id).not.toBe(report.id);
  expect(created.status).toBe('pending');
});

it('维护期间旧举报成功key只读核对，管理员受理例外可用，处理后原key可读取当前状态且不增副作用', async () => {
  const author = await verifiedCreator(stack),
    reporter = await verifiedCreator(stack),
    admin = await stack.admin();
  const persona = await publish(author.http, admin.http);
  const input = {
    target: { type: 'persona', personaId: persona.id },
    reason: 'other',
    details: '希望核对这份正常公开作品的来源说明',
  };
  const key = nonce();
  const initial = await reporter.http.write('/api/v1/reports', input, 'POST', key);
  expect(initial.status).toBe(200);
  const report = OwnReportResponseSchema.parse(await initial.json()).data;
  await setMaintenance(admin.http, true);
  const before = await facts('reports');
  const replay = await reporter.http.write('/api/v1/reports', input, 'POST', key);
  expect(replay.status).toBe(200);
  expect(OwnReportResponseSchema.parse(await replay.json()).data.id).toBe(report.id);
  expect((await reporter.http.raw('/api/v1/me/reports/' + report.id)).status).toBe(200);
  expect(await facts('reports')).toEqual(before);
  const accepted = await admin.http.write(
    '/api/v1/admin/reports/' + report.id + '/actions',
    {
      action: 'accept',
      message: '已受理并继续核实',
      privateNote: '',
      confirmed: true,
      selfReviewConfirmed: false,
    },
    'POST',
    { ...nonce(), 'If-Match': reportEtag(report.id, report.revision) },
  );
  expect(accepted.status).toBe(200);
  expect(AdminReportResponseSchema.parse(await accepted.json()).data.status).toBe('processing');
  const afterAccept = await facts('reports');
  const reconciled = await reporter.http.write('/api/v1/reports', input, 'POST', key);
  expect(reconciled.status).toBe(200);
  expect(OwnReportResponseSchema.parse(await reconciled.json()).data.status).toBe('processing');
  expect(await facts('reports')).toEqual(afterAccept);
});

it('维护中管理员发送两条站内通知与Worker投递继续，读取可用，偏好/单条/全部已读拒绝且关闭后恢复', async () => {
  const recipient = await verifiedCreator(stack),
    admin = await stack.admin();
  const account = (await recipient.http.context()).data.account;
  if (!account) throw new Error('缺少受控通知接收账号');
  await setMaintenance(admin.http, true);
  const ids: string[] = [];
  for (const title of ['维护期间第一份正常提醒', '维护期间第二份正常提醒']) {
    const response = await admin.http.write(
      '/api/v1/admin/notifications',
      {
        recipientId: account.id,
        title,
        message: '管理提醒继续投递，普通写入恢复后请明确重试',
        confirmed: true,
      },
      'POST',
      nonce(),
    );
    expect(response.status).toBe(200);
    ids.push(AdminNoticeResponseSchema.parse(await response.json()).data.id);
  }
  await expect
    .poll(async () => {
      await stack.tick();
      const delivered = await stack.owner.pool.query<{ total: number }>(
        "SELECT count(*)::int AS total FROM notifications WHERE id=ANY($1::uuid[]) AND status='delivered' AND delivered_at IS NOT NULL",
        [ids],
      );
      return delivered.rows[0]?.total;
    })
    .toBe(2);
  await expect
    .poll(async () => {
      await stack.tick();
      const queued = await stack.owner.pool.query<{ total: number }>(
        "SELECT count(*)::int AS total FROM notifications WHERE recipient_id=$1 AND status='queued'",
        [account.id],
      );
      return queued.rows[0]?.total;
    })
    .toBe(0);
  const inbox = NotificationsResponseSchema.parse(
    await (await recipient.http.raw('/api/v1/me/notifications')).json(),
  );
  expect(inbox.data.filter((row) => ids.includes(row.id))).toHaveLength(2);
  const count = NotificationCountResponseSchema.parse(
    await (await recipient.http.raw('/api/v1/me/notifications/count')).json(),
  ).data;
  expect(count.unreadCount).toBeGreaterThanOrEqual(2);
  if (!count.throughId) throw new Error('缺少正常批量已读边界');
  const initialPreferences = NotificationPreferencesResponseSchema.parse(
    await (await recipient.http.raw('/api/v1/me/notifications/preferences')).json(),
  );
  const selectedRows = () =>
    stack.owner.pool.query<{
      id: string;
      read_at: Date | null;
      status: string;
      title: string;
      message: string;
      target: unknown;
    }>(
      'SELECT id,read_at,status,title,message,target FROM notifications WHERE id=ANY($1::uuid[]) ORDER BY id',
      [ids],
    );
  const beforeRows = (await selectedRows()).rows,
    beforeEffects = await effects('notification');
  const storedPreferences = () =>
    stack.owner.pool.query<{
      user_id: string;
      review_email: boolean;
      revision: number;
      updated_at: Date;
    }>(
      'SELECT user_id,review_email,revision,updated_at FROM notification_preferences WHERE user_id=$1',
      [account.id],
    );
  const beforePreferences = (await storedPreferences()).rows;
  const candidate = {
    reviewEmail: !initialPreferences.data.reviewEmail,
    expectedRevision: initialPreferences.data.revision,
  };
  await expectMaintenance(
    await recipient.http.write('/api/v1/me/notifications/preferences', candidate, 'PATCH'),
  );
  const firstId = ids[0];
  if (!firstId) throw new Error('缺少正常通知');
  await expectMaintenance(
    await recipient.http.write('/api/v1/me/notifications/' + firstId + '/read', {}, 'PATCH'),
  );
  await expectMaintenance(
    await recipient.http.write(
      '/api/v1/me/notifications/read-all',
      { throughId: count.throughId },
      'PATCH',
    ),
  );
  expect((await selectedRows()).rows).toEqual(beforeRows);
  expect((await storedPreferences()).rows).toEqual(beforePreferences);
  expect(await effects('notification')).toEqual(beforeEffects);
  expect(
    NotificationPreferencesResponseSchema.parse(
      await (await recipient.http.raw('/api/v1/me/notifications/preferences')).json(),
    ),
  ).toEqual(initialPreferences);
  expect(
    NotificationCountResponseSchema.parse(
      await (await recipient.http.raw('/api/v1/me/notifications/count')).json(),
    ).data,
  ).toEqual(count);
  expect(
    NotificationsResponseSchema.parse(
      await (await recipient.http.raw('/api/v1/me/notifications')).json(),
    )
      .data.filter((row) => ids.includes(row.id))
      .every((row) => row.readAt === null),
  ).toBe(true);
  await setMaintenance(admin.http, false);
  const preferences = await recipient.http.write(
    '/api/v1/me/notifications/preferences',
    candidate,
    'PATCH',
  );
  expect(preferences.status).toBe(200);
  expect(NotificationPreferencesResponseSchema.parse(await preferences.json()).data).toEqual({
    reviewEmail: candidate.reviewEmail,
    revision: candidate.expectedRevision + 1,
  });
  const single = await recipient.http.write(
    '/api/v1/me/notifications/' + firstId + '/read',
    {},
    'PATCH',
  );
  expect(single.status).toBe(200);
  expect(NotificationReadResponseSchema.parse(await single.json()).data.updated).toBe(1);
  const all = await recipient.http.write(
    '/api/v1/me/notifications/read-all',
    { throughId: count.throughId },
    'PATCH',
  );
  expect(all.status).toBe(200);
  expect(
    NotificationReadResponseSchema.parse(await all.json()).data.updated,
  ).toBeGreaterThanOrEqual(1);
  expect((await selectedRows()).rows.every((row) => row.read_at !== null)).toBe(true);
});
