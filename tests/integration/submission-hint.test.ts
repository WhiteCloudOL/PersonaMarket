import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { createAdministrator } from '@personamarket/server';
import {
  AuthContextResponseSchema,
  CreationSettingsResponseSchema,
  ErrorResponseSchema,
  SubmissionPendingHintResponseSchema,
  SubmissionSettingsRecordsResponseSchema,
  SubmissionResponseSchema,
  SubmissionListResponseSchema,
  PublicReleaseResponseSchema,
  defaultCreationSettings,
  defaultSubmissionPendingHint,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { completePersona, verifiedCreator } from '../fixtures/creator.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
let author: Awaited<ReturnType<typeof verifiedCreator>>,
  other: Awaited<ReturnType<typeof verifiedCreator>>;
let admin: Awaited<ReturnType<Awaited<ReturnType<typeof createAuthStack>>['admin']>>;
const path = '/api/v1/admin/settings/creation';
beforeAll(async () => {
  stack = await createAuthStack();
  author = await verifiedCreator(stack);
  other = await verifiedCreator(stack);
  admin = await stack.admin();
});
afterAll(async () => {
  await stack?.close();
});
async function settings() {
  return CreationSettingsResponseSchema.parse(await (await admin.http.raw(path)).json());
}
async function save(pendingHint: string, key = randomUUID()) {
  const before = await settings();
  const input = {
    data: { ...before.data, submissions: { ...before.data.submissions, pendingHint } },
    expected: before.meta,
    reason: '隔离验证待审提示更新',
  };
  const response = await admin.http.write(path, input, 'PATCH', { 'Idempotency-Key': key });
  expect(response.status).toBe(200);
  return { result: CreationSettingsResponseSchema.parse(await response.json()), input, key };
}
beforeEach(async () => {
  const current = await settings();
  const response = await admin.http.write(
    path,
    { data: defaultCreationSettings, expected: current.meta, reason: '初始化本用例独立投稿策略' },
    'PATCH',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(response.status).toBe(200);
});
async function submit(platform: 'maibot' | 'astrbot' = 'maibot') {
  const persona = await completePersona(author.http, platform);
  const response = await author.http.write(
    '/api/v1/me/personas/' + persona.id + '/releases',
    { version: '1.0.0', changelog: '验证当前待审说明', expectedDraftRevision: 2, confirmed: true },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(response.status).toBe(200);
  return { persona, submission: SubmissionResponseSchema.parse(await response.json()).data };
}
async function hint(id: string) {
  const response = await author.http.raw('/api/v1/me/submissions/' + id + '/pending-hint');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  return SubmissionPendingHintResponseSchema.parse(await response.json());
}
async function review(id: string, action: 'approve' | 'reject') {
  const response = await admin.http.write(
    '/api/v1/admin/moderation/submissions/' + id + '/review',
    { action, expectedRevision: 1, reason: '按真实审核状态处理', selfReviewConfirmed: false },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(response.status).toBe(200);
}

it('仅本人PENDING读取白名单当前提示，匿名/他人/非作者管理员无法越权', async () => {
  const { submission } = await submit();
  const result = await hint(submission.id);
  expect(result.data).toEqual({
    submissionId: submission.id,
    pendingHint: defaultSubmissionPendingHint,
  });
  expect(Object.keys(result.meta)).toEqual(['settingsRevision']);
  const endpoint = '/api/v1/me/submissions/' + submission.id + '/pending-hint';
  expect((await stack.browser().raw(endpoint)).status).toBe(401);
  expect((await other.http.raw(endpoint)).status).toBe(404);
  expect((await admin.http.raw(endpoint)).status).toBe(404);
  for (const target of [path, path + '/records']) {
    expect((await stack.browser().raw(target)).status).toBe(401);
    expect((await author.http.raw(target)).status).toBe(403);
  }
});

it('提示按当前修订读取、纯文本和空值保留，旧公开版/快照/邮件载荷均不回写', async () => {
  const { persona, submission } = await submit('astrbot');
  await review(submission.id, 'approve');
  const second = await author.http.write(
    '/api/v1/me/personas/' + persona.id + '/releases',
    {
      version: '1.1.0',
      changelog: '旧公开版本之后的新待审版本',
      expectedDraftRevision: 2,
      confirmed: true,
    },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(second.status).toBe(200);
  const pending = SubmissionResponseSchema.parse(await second.json()).data;
  const original = PublicReleaseResponseSchema.parse(
    await (await stack.browser().raw('/api/v1/personas/' + persona.id)).json(),
  );
  const messages = await stack.owner.pool.query(
    "SELECT id,md5(payload::text) AS hash FROM outbox_events WHERE topic='auth.email' ORDER BY id",
  );
  expect(messages.rows.length).toBeGreaterThan(0);
  const text = '  **当前待审说明**\n保持原始换行与空白  ';
  const saved = await save(text);
  expect(await hint(pending.id)).toEqual({
    data: { submissionId: pending.id, pendingHint: text },
    meta: { settingsRevision: saved.result.meta.submissions },
  });
  expect(
    PublicReleaseResponseSchema.parse(
      await (await stack.browser().raw('/api/v1/personas/' + persona.id)).json(),
    ),
  ).toEqual(original);
  const current = SubmissionListResponseSchema.parse(
    await (await author.http.raw('/api/v1/me/personas/' + persona.id + '/releases')).json(),
  ).data.find((item) => item.id === pending.id);
  if (!current) throw new Error('缺少真实待审提交');
  expect(current.snapshot).toEqual(pending.snapshot);
  expect(current.contentHash).toBe(pending.contentHash);
  expect(
    (
      await stack.owner.pool.query(
        "SELECT id,md5(payload::text) AS hash FROM outbox_events WHERE topic='auth.email' ORDER BY id",
      )
    ).rows,
  ).toEqual(messages.rows);
  await save('');
  expect((await hint(pending.id)).data.pendingHint).toBe('');
});

it('APPROVED、REJECTED和WITHDRAWN均不再返回待审提示', async () => {
  for (const status of ['approved', 'rejected', 'withdrawn'] as const) {
    const { submission } = await submit();
    if (status === 'withdrawn')
      expect(
        (
          await author.http.write('/api/v1/me/submissions/' + submission.id + '/withdraw', {
            expectedRevision: 1,
            reason: '作者正常撤回待审版本',
          })
        ).status,
      ).toBe(200);
    else await review(submission.id, status === 'approved' ? 'approve' : 'reject');
    expect(
      (await author.http.raw('/api/v1/me/submissions/' + submission.id + '/pending-hint')).status,
    ).toBe(404);
  }
});

it('旧PATCH省略提示保留自定义值，双修订CAS与同key重放不重复记录', async () => {
  const { result, input, key } = await save('自定义待审提示不会被旧载荷清空');
  const recordsBefore = await stack.owner.pool.query(
    "SELECT key,count(*)::int AS total FROM site_setting_records WHERE key IN ('submissions','contentLimits') GROUP BY key ORDER BY key",
  );
  expect((await admin.http.write(path, input, 'PATCH', { 'Idempotency-Key': key })).status).toBe(
    200,
  );
  expect((await settings()).meta).toEqual(result.meta);
  expect(
    (
      await stack.owner.pool.query(
        "SELECT key,count(*)::int AS total FROM site_setting_records WHERE key IN ('submissions','contentLimits') GROUP BY key ORDER BY key",
      )
    ).rows,
  ).toEqual(recordsBefore.rows);
  const changed = await admin.http.write(
    path,
    { ...input, reason: '同key的另一个操作理由' },
    'PATCH',
    { 'Idempotency-Key': key },
  );
  expect(changed.status).toBe(409);
  expect(ErrorResponseSchema.parse(await changed.json()).error.code).toBe('CONFLICT');
  const legacy = await admin.http.write(
    path,
    {
      data: {
        ...result.data,
        submissions: { enabled: false, platforms: ['maibot'], dailyQuota: 3 },
      },
      expected: result.meta,
    },
    'PATCH',
  );
  expect(legacy.status).toBe(200);
  expect(CreationSettingsResponseSchema.parse(await legacy.json()).data.submissions).toEqual({
    enabled: false,
    platforms: ['maibot'],
    dailyQuota: 3,
    pendingHint: result.data.submissions.pendingHint,
  });
  expect(
    (await admin.http.write(path, input, 'PATCH', { 'Idempotency-Key': randomUUID() })).status,
  ).toBe(412);
});

it('无效或越界提示由API拒绝，配置、修订与审计均保持', async () => {
  const before = await settings();
  const records = await stack.owner.pool.query(
    "SELECT key,count(*)::int AS total FROM site_setting_records WHERE key IN ('submissions','contentLimits') GROUP BY key ORDER BY key",
  );
  for (const pendingHint of [' \t\n', '🌟'.repeat(501), '说明\u0000正文']) {
    const response = await admin.http.write(
      path,
      {
        data: { ...before.data, submissions: { ...before.data.submissions, pendingHint } },
        expected: before.meta,
        reason: '验证受控纯文本边界',
      },
      'PATCH',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(response.status).toBe(400);
  }
  expect(await settings()).toEqual(before);
  expect(
    (
      await stack.owner.pool.query(
        "SELECT key,count(*)::int AS total FROM site_setting_records WHERE key IN ('submissions','contentLimits') GROUP BY key ORDER BY key",
      )
    ).rows,
  ).toEqual(records.rows);
});

it('并发双组CAS仅一份生效，审计前后值与真实修订原子一致', async () => {
  const before = await settings();
  const concurrentAdmin = await stack.admin();
  const inputs = ['并发候选甲', '并发候选乙'].map((pendingHint) => ({
    data: { ...before.data, submissions: { ...before.data.submissions, pendingHint } },
    expected: before.meta,
    reason: pendingHint,
  }));
  const responses = await Promise.all(
    inputs.map((input, index) =>
      (index ? concurrentAdmin.http : admin.http).write(path, input, 'PATCH', {
        'Idempotency-Key': randomUUID(),
      }),
    ),
  );
  expect(responses.map((response) => response.status).sort()).toEqual([200, 412]);
  const winner = responses.findIndex((response) => response.status === 200);
  const current = await settings();
  expect(current.data).toEqual(inputs[winner]?.data);
  expect(current.meta).toEqual({
    contentLimits: before.meta.contentLimits + 1,
    submissions: before.meta.submissions + 1,
  });
  const records = SubmissionSettingsRecordsResponseSchema.parse(
    await (await admin.http.raw(path + '/records')).json(),
  );
  const latest = records.data[0];
  expect(latest?.before).toEqual(before.data.submissions);
  expect(latest?.after).toEqual(current.data.submissions);
  expect(latest?.fromRevision).toBe(before.meta.submissions);
  expect(latest?.toRevision).toBe(current.meta.submissions);
  expect((await admin.http.raw(path + '/records?page=101')).status).toBe(400);
  expect(
    (await admin.http.raw(path, { headers: { 'X-Expected-Account': randomUUID() } })).status,
  ).toBe(409);
});

it('过期近期验证仍允许普通管理员维护，旧历史缺字段显示null且只读适配不回写', async () => {
  const context = AuthContextResponseSchema.parse(
    await (await admin.http.raw('/api/v1/auth/context')).json(),
  ).data;
  if (!context.account) throw new Error('缺少受控管理员');
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET mfa_verified_at=now()-interval '11 minutes' WHERE user_id=$1",
    [context.account.id],
  );
  await save('普通业务设置沿用有效管理员会话');
  const username = 'hint_admin_' + randomUUID().replaceAll('-', '').slice(0, 10);
  const password = 'Unbound administrator fixture 2026';
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
    "UPDATE auth_sessions SET created_at=now()-interval '11 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
    [username],
  );
  const state = await settings();
  expect(
    (
      await unbound.write(
        path,
        { data: state.data, expected: state.meta, reason: '未绑定MFA管理员的正常维护' },
        'PATCH',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  const legacy = {
    enabled: true,
    platforms: ['maibot'],
    dailyQuota: 5,
    internalOnly: '不得进入白名单响应',
  };
  const row = await stack.owner.pool.query(
    "INSERT INTO site_setting_records(key,actor_id,reason,before_value,after_value,from_revision,to_revision,request_id) VALUES('submissions',$1,'旧历史格式',$2,$2,1000,1001,$3) RETURNING id",
    [context.account.id, legacy, randomUUID()],
  );
  const original = await stack.owner.pool.query(
    'SELECT before_value,after_value FROM site_setting_records WHERE id=$1',
    [row.rows[0]?.id],
  );
  const history = SubmissionSettingsRecordsResponseSchema.parse(
    await (await admin.http.raw(path + '/records')).json(),
  );
  expect(history.data[0]?.before).toEqual({
    enabled: true,
    platforms: ['maibot'],
    dailyQuota: 5,
    pendingHint: null,
  });
  expect(history.data[0]?.after.pendingHint).toBeNull();
  expect(JSON.stringify(history)).not.toContain('internalOnly');
  expect(
    (
      await stack.owner.pool.query(
        'SELECT before_value,after_value FROM site_setting_records WHERE id=$1',
        [row.rows[0]?.id],
      )
    ).rows,
  ).toEqual(original.rows);
});
