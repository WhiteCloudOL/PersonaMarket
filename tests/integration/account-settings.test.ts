import { seedLegacyUnverified } from '../fixtures/legacy-account.js';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { AuthRepository } from '@personamarket/api/testing';
import {
  AccountSettingsResponseSchema,
  AccountSettingsRecordsResponseSchema,
  AdminUserResponseSchema,
  AuthNoticeResponseSchema,
  ErrorResponseSchema,
  MailSettingsResponseSchema,
  OwnProfileResponseSchema,
  accountSettingsEtag,
  type AccountSettings,
} from '@personamarket/contracts';
import { createAdministrator, hashPassword } from '@personamarket/server';
import { createAuthStack } from '../fixtures/auth-stack.js';
import type { AuthHttp } from '../fixtures/auth-http.js';
import { completePersona } from '../fixtures/creator.js';
import { mailCode, mailToken } from '../fixtures/mailpit.js';

// 每例只有一套真实API/PG/Redis/Worker，正常SMTP始终运行；不停止或故障注入基础设施。
let stack: Awaited<ReturnType<typeof createAuthStack>>;
const path = '/api/v1/admin/settings/accounts';
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});
const person = () => {
  const username = 'account_' + randomUUID().replaceAll('-', '').slice(0, 12);
  return {
    username,
    email: username + '@fixture.invalid',
    password: 'A distinct account fixture passphrase 2026',
  };
};
async function settings(http: AuthHttp) {
  const response = await http.raw(path);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  const result = AccountSettingsResponseSchema.parse(await response.json());
  expect(response.headers.get('etag')).toBe(accountSettingsEtag(result.meta.revision));
  return result;
}
async function save(
  http: AuthHttp,
  patch: Partial<AccountSettings>,
  reason = '隔离验收注册与账户策略',
) {
  const current = await settings(http),
    input = { data: { ...current.data, ...patch }, reason };
  const key = randomUUID();
  const account = (await http.context()).data.account;
  if (!account) throw new Error('缺少测试管理员身份');
  const headers = {
    'If-Match': accountSettingsEtag(current.meta.revision),
    'Idempotency-Key': key,
    'X-Expected-Account': account.id,
  };
  const response = await http.write(path, input, 'PATCH', headers);
  expect(response.status).toBe(200);
  return { result: AccountSettingsResponseSchema.parse(await response.json()), input, headers };
}
async function outboxCount() {
  const result = await stack.owner.pool.query<{ count: number }>(
    "SELECT count(*)::integer AS count FROM outbox_events WHERE topic='auth.email'",
  );
  return result.rows[0]?.count ?? 0;
}
async function state(username: string) {
  const result = await stack.owner.pool.query<{ verified: boolean; tokens: number }>(
    'SELECT email_verified_at IS NOT NULL AS verified,(SELECT count(*)::integer FROM auth_tokens WHERE user_id=users.id) AS tokens FROM users WHERE username=$1',
    [username],
  );
  return result.rows[0];
}
async function optionalAdmin() {
  const credentials = person();
  await createAdministrator(stack.owner, credentials);
  const http = stack.browser();
  expect(
    (
      await http.write('/api/v1/auth/login', {
        identifier: credentials.username,
        password: credentials.password,
      })
    ).status,
  ).toBe(200);
  return { http, credentials };
}
async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  const result = ErrorResponseSchema.parse(await response.json());
  expect(result.error.code).toBe(code);
  return result;
}

it('注册必须先收取真实验证码，公开上下文保持白名单', async () => {
  const http = stack.browser(),
    input = person();
  const context = await http.context();
  expect(context.data.registrationAvailable).toBe(true);
  expect(context.data.registrationPolicy).toEqual({
    verificationEmailTiming: 'on_registration',
    settingsRevision: 1,
  });
  expect(Object.keys(context.data.registrationPolicy).sort()).toEqual([
    'settingsRevision',
    'verificationEmailTiming',
  ]);
  const issued = await http.write('/api/v1/auth/register/code', { email: input.email });
  expect(issued.status).toBe(200);
  expect(AuthNoticeResponseSchema.parse(await issued.json()).data.message).toContain('验证码');
  expect(await state(input.username)).toBeUndefined();
  expect(await outboxCount()).toBe(1);
  expect((await http.context()).data.account).toBeNull();
  const code = await mailCode(input.email, '注册', stack.tick);
  expect((await http.write('/api/v1/auth/register', { ...input, code })).status).toBe(200);
  expect(await state(input.username)).toEqual({ verified: true, tokens: 0 });
  expect(
    (
      await http.write('/api/v1/auth/login', {
        identifier: input.username,
        password: input.password,
      })
    ).status,
  ).toBe(200);
  expect((await http.context()).data.account?.emailVerified).toBe(true);
});

it('旧按需配置不能跳过新注册校验，历史未验证账号仍可保存私稿和申请验证', async () => {
  const admin = await stack.admin();
  const saved = await save(admin.http, { verificationEmailTiming: 'on_request' });
  const http = stack.browser(),
    input = person(),
    initialMail = await outboxCount();
  expect((await http.context()).data.registrationPolicy).toEqual({
    verificationEmailTiming: 'on_request',
    settingsRevision: saved.result.meta.revision,
  });
  expect((await http.write('/api/v1/auth/register', { ...input, code: '000000' })).status).toBe(
    400,
  );
  expect(await state(input.username)).toBeUndefined();
  await seedLegacyUnverified(stack.owner, input);
  expect(await state(input.username)).toEqual({ verified: false, tokens: 0 });
  expect(await outboxCount()).toBe(initialMail);
  expect(
    (
      await http.write('/api/v1/auth/login', {
        identifier: input.username,
        password: input.password,
      })
    ).status,
  ).toBe(200);
  const draft = await completePersona(http);
  const rejected = await expectError(
    await http.write(
      '/api/v1/me/personas/' + draft.id + '/releases',
      {
        version: '1.0.0',
        changelog: '正常邮箱验证边界',
        expectedDraftRevision: 2,
        confirmed: true,
      },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    ),
    403,
    'FORBIDDEN',
  );
  expect(rejected.error.message).toContain('验证邮箱');
  const comment = await expectError(
    await http.write(
      '/api/v1/personas/' + draft.id + '/comments',
      { body: '正常邮箱验证前的评论尝试' },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    ),
    403,
    'FORBIDDEN',
  );
  expect(comment.error.message).toContain('验证邮箱');
  for (const action of ['like', 'favorite']) {
    const result = await expectError(
      await http.write('/api/v1/personas/' + draft.id + '/' + action, {}, 'PUT'),
      403,
      'FORBIDDEN',
    );
    expect(result.error.message).toContain('验证邮箱');
  }
  const profile = OwnProfileResponseSchema.parse(
    await (await http.raw('/api/v1/me/profile')).json(),
  );
  const savedProfileResponse = await http.write(
    '/api/v1/me/profile',
    {
      content: { ...profile.data.content, bio: '未验证账号可保留自己的资料草稿' },
      expectedRevision: profile.data.revision,
    },
    'PUT',
  );
  expect(savedProfileResponse.status).toBe(200);
  const savedProfile = OwnProfileResponseSchema.parse(await savedProfileResponse.json());
  const profileSubmit = await expectError(
    await http.write(
      '/api/v1/me/profile/submissions',
      { expectedDraftRevision: savedProfile.data.revision, confirmed: true },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    ),
    403,
    'FORBIDDEN',
  );
  expect(profileSubmit.error.message).toContain('验证邮箱');
  // 合法公网URL在邮箱门禁处被拒，未创建抓取任务，不执行外部图片抓取。
  const imageImport = await expectError(
    await http.write('/api/v1/me/assets/import-url', { url: 'https://example.com/fixture.png' }),
    403,
    'FORBIDDEN',
  );
  expect(imageImport.error.message).toContain('验证邮箱');
  // 若注册误扣3/15min收件人预算，此显式申请会429。
  expect(
    (await http.write('/api/v1/auth/resend-verification', { email: input.email })).status,
  ).toBe(200);
  expect((await state(input.username))?.tokens).toBe(1);
  expect(
    (
      await http.write('/api/v1/auth/verify-email', {
        token: await mailToken(input.email, 'verify-email', stack.tick),
      })
    ).status,
  ).toBe(200);
  const afterVerification = await http.context();
  expect(afterVerification.data.account).toBeNull();
  expect(afterVerification.data.assurance).toBe('anonymous');
  expect(
    (
      await http.write('/api/v1/auth/login', {
        identifier: input.username,
        password: input.password,
      })
    ).status,
  ).toBe(200);
  expect((await http.context()).data.account?.emailVerified).toBe(true);
  expect(
    (
      await http.write(
        '/api/v1/me/personas/' + draft.id + '/releases',
        {
          version: '1.0.0',
          changelog: '邮箱验证后正常投稿',
          expectedDraftRevision: 2,
          confirmed: true,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
});

it('关闭注册只阻止新申请，已有账号可登录、显式验证和找回；新会话使用新TTL', async () => {
  const admin = await stack.admin();
  await save(admin.http, { verificationEmailTiming: 'on_request', sessionTtlSeconds: 600 });
  const http = stack.browser(),
    input = person();
  await seedLegacyUnverified(stack.owner, input);
  await save(admin.http, { registrationEnabled: false });
  expect((await http.context()).data.registrationAvailable).toBe(false);
  await expectError(
    await http.write('/api/v1/auth/register/code', { email: person().email }),
    503,
    'SERVICE_UNAVAILABLE',
  );
  expect(
    (
      await http.write('/api/v1/auth/login', {
        identifier: input.username,
        password: input.password,
      })
    ).status,
  ).toBe(200);
  const context = await http.context();
  const remaining = Date.parse(context.data.sessionExpiresAt ?? '') - Date.now();
  expect(remaining).toBeGreaterThan(570_000);
  expect(remaining).toBeLessThanOrEqual(600_000);
  expect(
    (await http.write('/api/v1/auth/resend-verification', { email: input.email })).status,
  ).toBe(200);
  expect(
    (
      await http.write('/api/v1/auth/verify-email', {
        token: await mailToken(input.email, 'verify-email', stack.tick),
      })
    ).status,
  ).toBe(200);
  expect((await http.write('/api/v1/auth/forgot-password', { email: input.email })).status).toBe(
    200,
  );
  expect((await mailToken(input.email, 'reset-password', stack.tick)).length).toBe(43);
});

it.each(['on_registration', 'on_request'] as const)(
  '正常产品设置禁用邮件时%s注册均拒绝且不留下半份业务记录',
  async (verificationEmailTiming) => {
    const admin = await stack.admin();
    await save(admin.http, { verificationEmailTiming });
    const currentMail = MailSettingsResponseSchema.parse(
      await (await admin.http.raw('/api/v1/admin/settings/mail')).json(),
    );
    expect(
      (
        await admin.http.write('/api/v1/admin/settings/mail', { mode: 'disabled' }, 'PATCH', {
          'If-Match': '"mail-' + currentMail.meta.revision + '"',
        })
      ).status,
    ).toBe(200);
    const beforeMail = await outboxCount(),
      http = stack.browser(),
      input = person();
    expect((await http.context()).data.registrationAvailable).toBe(false);
    await expectError(
      await http.write('/api/v1/auth/register/code', { email: input.email }),
      503,
      'SERVICE_UNAVAILABLE',
    );
    expect(await state(input.username)).toBeUndefined();
    expect(await outboxCount()).toBe(beforeMail);
    const accounts = await settings(admin.http);
    await expectError(
      await admin.http.write(
        path,
        { data: accounts.data, reason: '邮件禁用时不能继续开放注册' },
        'PATCH',
        { 'If-Match': accountSettingsEtag(accounts.meta.revision) },
      ),
      503,
      'SERVICE_UNAVAILABLE',
    );
    expect((await settings(admin.http)).meta).toEqual(accounts.meta);
  },
);

it('普通读不追加近期验证，高危写要求真实密码确认；已知幂等请求可核对而不重复写', async () => {
  const admin = await optionalAdmin();
  const original = await save(admin.http, { verificationEmailTiming: 'on_request' });
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET created_at=now()-interval '11 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
    [admin.credentials.username],
  );
  expect((await admin.http.raw(path)).status).toBe(200);
  expect((await admin.http.raw(path + '/records')).status).toBe(200);
  expect((await admin.http.write(path, original.input, 'PATCH', original.headers)).status).toBe(
    200,
  );
  const current = await settings(admin.http),
    headers = {
      'If-Match': accountSettingsEtag(current.meta.revision),
      'Idempotency-Key': randomUUID(),
    };
  const input = {
    data: { ...current.data, registrationRateLimit: { maxAttempts: 2, windowSeconds: 60 } },
    reason: '密码确认后由用户显式重试',
  };
  await expectError(await admin.http.write(path, input, 'PATCH', headers), 403, 'REAUTH_REQUIRED');
  expect((await settings(admin.http)).meta).toEqual(current.meta);
  expect(
    (
      await admin.http.write('/api/v1/auth/reauthenticate', {
        currentPassword: admin.credentials.password,
      })
    ).status,
  ).toBe(200);
  // 身份确认本身不能代替原请求写入。
  expect((await settings(admin.http)).meta).toEqual(current.meta);
  expect((await admin.http.write(path, input, 'PATCH', headers)).status).toBe(200);
  const records = AccountSettingsRecordsResponseSchema.parse(
    await (await admin.http.raw(path + '/records')).json(),
  );
  expect(records.meta.total).toBe(2);
});

it('已绑定MFA的过期高危写保持MFA_REQUIRED，不能使用密码确认绕过', async () => {
  const admin = await stack.admin(),
    current = await settings(admin.http);
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET mfa_verified_at=now()-interval '11 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
    [admin.credentials.username],
  );
  expect((await admin.http.raw(path + '/records')).status).toBe(200);
  await expectError(
    await admin.http.write(path, { data: current.data, reason: '核实MFA高危保护' }, 'PATCH', {
      'If-Match': accountSettingsEtag(current.meta.revision),
    }),
    403,
    'MFA_REQUIRED',
  );
  await expectError(
    await admin.http.write('/api/v1/auth/reauthenticate', {
      currentPassword: admin.credentials.password,
    }),
    403,
    'MFA_REQUIRED',
  );
  expect((await settings(admin.http)).meta).toEqual(current.meta);
});

it('CAS并发只提交一次，幂等与账号核对保护，历史和审计与修订同事务', async () => {
  const admin = await stack.admin(),
    current = await settings(admin.http),
    account = (await admin.http.context()).data.account;
  if (!account) throw new Error('缺少测试管理员身份');
  const candidate = {
    data: { ...current.data, verificationEmailTiming: 'on_request' },
    reason: '并发注册策略更新',
  };
  const headers = {
    'If-Match': accountSettingsEtag(current.meta.revision),
    'Idempotency-Key': randomUUID(),
    'X-Expected-Account': account.id,
  };
  const otherInput = { ...candidate, reason: '另一项并发更新' },
    otherHeaders = { ...headers, 'Idempotency-Key': randomUUID() };
  const responses = await Promise.all([
    admin.http.write(path, candidate, 'PATCH', headers),
    admin.http.write(path, otherInput, 'PATCH', otherHeaders),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([200, 412]);
  // 找到胜出的原始输入，避免假定并发顺序。
  const winner =
    responses[0]?.status === 200
      ? { input: candidate, headers }
      : { input: otherInput, headers: otherHeaders };
  expect((await admin.http.write(path, winner.input, 'PATCH', winner.headers)).status).toBe(200);
  await expectError(
    await admin.http.write(
      path,
      { ...winner.input, reason: '同键不同理由' },
      'PATCH',
      winner.headers,
    ),
    409,
    'CONFLICT',
  );
  const saved = await settings(admin.http);
  await expectError(
    await admin.http.write(path, { data: saved.data, reason: '账号不匹配不能写入' }, 'PATCH', {
      'If-Match': accountSettingsEtag(saved.meta.revision),
      'X-Expected-Account': randomUUID(),
    }),
    409,
    'CONFLICT',
  );
  const records = AccountSettingsRecordsResponseSchema.parse(
    await (await admin.http.raw(path + '/records')).json(),
  );
  expect(records.meta).toEqual({ page: 1, pageSize: 20, total: 1 });
  expect(records.data[0]).toMatchObject({
    fromRevision: current.meta.revision,
    toRevision: current.meta.revision + 1,
    before: { effective: current.data },
    after: { effective: saved.data },
  });
  expect(
    (
      await stack.owner.pool.query(
        "SELECT id FROM auth_audit_events WHERE event='admin.accounts_updated'",
      )
    ).rowCount,
  ).toBe(1);
  expect((await admin.http.raw(path + '/records?page=2')).status).toBe(200);
});

it('旧flat PATCH保留新策略；原始null与历史缺失字段不被今天默认值伪装', async () => {
  const admin = await stack.admin(),
    account = (await admin.http.context()).data.account;
  if (!account) throw new Error('缺少测试管理员身份');
  // 正常升级来源夹具：模拟旧版本已存在的一条有效设置历史，不改角色/会话权限。
  const old = { registrationEnabled: null, sessionTtlSeconds: null };
  await stack.owner.pool.query(
    "UPDATE site_settings SET value=$1,revision=2 WHERE key='accounts'",
    [old],
  );
  await stack.owner.pool.query(
    "INSERT INTO site_setting_records(key,actor_id,reason,before_value,after_value,from_revision,to_revision,request_id) VALUES('accounts',$1,'旧版本设置记录',$2,$2,1,2,$3)",
    [account.id, old, randomUUID()],
  );
  const saved = await save(admin.http, {
    verificationEmailTiming: 'on_request',
    registrationRateLimit: { maxAttempts: 3, windowSeconds: 120 },
  });
  const legacy = await admin.http.write(
    path,
    { registrationEnabled: true, sessionTtlSeconds: 7200 },
    'PATCH',
    { 'If-Match': accountSettingsEtag(saved.result.meta.revision) },
  );
  expect(legacy.status).toBe(200);
  expect(AccountSettingsResponseSchema.parse(await legacy.json()).data).toMatchObject({
    verificationEmailTiming: 'on_request',
    registrationRateLimit: { maxAttempts: 3, windowSeconds: 120 },
    sessionTtlSeconds: 7200,
  });
  const records = AccountSettingsRecordsResponseSchema.parse(
    await (await admin.http.raw(path + '/records')).json(),
  );
  expect(records.data.find((record) => record.fromRevision === 1)?.before).toEqual({
    stored: { ...old, verificationEmailTiming: null, registrationRateLimit: null },
    effective: null,
  });
  const freshRecord = records.data.find((record) => record.fromRevision === 2);
  expect(freshRecord?.before.stored).toEqual({
    ...old,
    verificationEmailTiming: null,
    registrationRateLimit: null,
  });
  expect(freshRecord?.before.effective?.registrationEnabled).toBe(true);
  expect(records.data[0]?.after.effective?.sessionTtlSeconds).toBe(7200);
});

it('匿名与普通用户不能读取私有策略/历史或修改策略，分页和缺失CAS被校验', async () => {
  const admin = await stack.admin();
  const saved = await save(admin.http, { verificationEmailTiming: 'on_request' });
  const ordinary = stack.browser(),
    input = person();
  expect((await ordinary.register(input, stack.tick)).status).toBe(200);
  expect(
    (
      await ordinary.write('/api/v1/auth/login', {
        identifier: input.username,
        password: input.password,
      })
    ).status,
  ).toBe(200);
  for (const route of [path, path + '/records']) {
    await expectError(await stack.browser().raw(route), 401, 'UNAUTHENTICATED');
    await expectError(await ordinary.raw(route), 403, 'FORBIDDEN');
  }
  await expectError(
    await ordinary.write(path, saved.input, 'PATCH', saved.headers),
    403,
    'FORBIDDEN',
  );
  expect((await admin.http.raw(path + '/records?page=101')).status).toBe(400);
  await expectError(await admin.http.write(path, saved.input, 'PATCH'), 412, 'REVISION_CONFLICT');
  expect((await settings(admin.http)).meta).toEqual(saved.result.meta);
});

it('通过正常角色管理撤销管理员后旧会话立即阻断，新普通身份不能读取或写入账户设置', async () => {
  const first = await optionalAdmin(),
    second = await optionalAdmin(),
    original = await settings(first.http);
  const target = (await first.http.context()).data.account;
  if (!target) throw new Error('缺少待调整角色的隔离管理员');
  const detail = AdminUserResponseSchema.parse(
    await (await second.http.raw('/api/v1/admin/users/' + target.id)).json(),
  ).data;
  expect(
    (
      await second.http.write(
        '/api/v1/admin/users/' + target.id + '/role',
        {
          role: 'user',
          expectedSecurityVersion: detail.securityVersion,
          reason: '正常管理流程验证账户策略的角色撤销',
        },
        'PUT',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  for (const route of [path, path + '/records'])
    await expectError(await first.http.raw(route), 401, 'UNAUTHENTICATED');
  await expectError(
    await first.http.write(path, { data: original.data, reason: '旧会话不能继续保存' }, 'PATCH', {
      'If-Match': accountSettingsEtag(original.meta.revision),
    }),
    401,
    'UNAUTHENTICATED',
  );
  expect(
    (
      await first.http.write('/api/v1/auth/login', {
        identifier: first.credentials.username,
        password: first.credentials.password,
      })
    ).status,
  ).toBe(200);
  expect((await first.http.context()).data.account?.role).toBe('user');
  await expectError(await first.http.raw(path), 403, 'FORBIDDEN');
  await expectError(
    await first.http.write(path, { data: original.data, reason: '新普通身份仍无权保存' }, 'PATCH', {
      'If-Match': accountSettingsEtag(original.meta.revision),
    }),
    403,
    'FORBIDDEN',
  );
  expect((await settings(second.http)).meta).toEqual(original.meta);
});

it('业务IP窗口沿用同窗口计数，修改无关字段/次数不重置，切回未过期窗口复用旧计数', async () => {
  const admin = await stack.admin();
  await save(admin.http, {
    verificationEmailTiming: 'on_request',
    registrationRateLimit: { maxAttempts: 3, windowSeconds: 60 },
  });
  for (let index = 0; index < 2; index++)
    expect((await stack.browser().register(person(), stack.tick)).status).toBe(200);
  await save(admin.http, {
    sessionTtlSeconds: 7200,
    registrationRateLimit: { maxAttempts: 2, windowSeconds: 60 },
  });
  const blocked = await stack
    .browser()
    .write('/api/v1/auth/register', { ...person(), code: '000000' });
  await expectError(blocked, 429, 'RATE_LIMITED');
  expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  await save(admin.http, { registrationRateLimit: { maxAttempts: 2, windowSeconds: 120 } });
  expect((await stack.browser().register(person(), stack.tick)).status).toBe(200);
  await save(admin.http, { registrationRateLimit: { maxAttempts: 2, windowSeconds: 60 } });
  await expectError(
    await stack.browser().write('/api/v1/auth/register', { ...person(), code: '000000' }),
    429,
    'RATE_LIMITED',
  );
});

it('真实Redis并发限制只有一个正常申请获准，常见密码拒绝也计入注册尝试', async () => {
  const admin = await stack.admin();
  await save(admin.http, {
    verificationEmailTiming: 'on_request',
    registrationRateLimit: { maxAttempts: 1, windowSeconds: 60 },
  });
  const inputs = [person(), person()];
  const responses = await Promise.all(
    inputs.map((input) => stack.browser().register(input, stack.tick)),
  );
  expect(responses.map((response) => response.status).sort()).toEqual([200, 429]);
  expect(
    (
      await stack.owner.pool.query('SELECT id FROM users WHERE username=ANY($1::text[])', [
        inputs.map((input) => input.username),
      ])
    ).rowCount,
  ).toBe(1);
  await save(admin.http, { registrationRateLimit: { maxAttempts: 1, windowSeconds: 120 } });
  const weak = person(),
    beforeMail = await outboxCount();
  await expectError(
    await stack
      .browser()
      .write('/api/v1/auth/register', { ...weak, password: 'passwordpassword', code: '000000' }),
    400,
    'INVALID_INPUT',
  );
  expect(await state(weak.username)).toBeUndefined();
  expect(await outboxCount()).toBe(beforeMail);
  await expectError(
    await stack.browser().write('/api/v1/auth/register', { ...person(), code: '000000' }),
    429,
    'RATE_LIMITED',
  );
});

it('固定register-ip十次每小时上限保留，切换业务窗口不能重置硬保护', async () => {
  const admin = await stack.admin();
  await save(admin.http, {
    verificationEmailTiming: 'on_request',
    registrationRateLimit: { maxAttempts: 10, windowSeconds: 60 },
  });
  // 使用正常常见密码失败避免创建十个不必要的账号；仍是实际业务校验与Redis计数。
  for (let index = 0; index < 10; index++) {
    if (index === 5)
      await save(admin.http, { registrationRateLimit: { maxAttempts: 10, windowSeconds: 120 } });
    await expectError(
      await stack.browser().write('/api/v1/auth/register', {
        ...person(),
        password: 'passwordpassword',
        code: '000000',
      }),
      400,
      'INVALID_INPUT',
    );
  }
  await save(admin.http, { registrationRateLimit: { maxAttempts: 10, windowSeconds: 180 } });
  await expectError(
    await stack.browser().write('/api/v1/auth/register', { ...person(), code: '000000' }),
    429,
    'RATE_LIMITED',
  );
});

it('注册最终真实事务核对accounts及mail修订，不沿用SMTP/哈希前的旧策略写半份账号', async () => {
  const admin = await stack.admin();
  const initial = await save(admin.http, { verificationEmailTiming: 'on_request' });
  const mail = MailSettingsResponseSchema.parse(
    await (await admin.http.raw('/api/v1/admin/settings/mail')).json(),
  );
  const repository = new AuthRepository(stack.owner, stack.env),
    first = person();
  const passwordHash = await hashPassword(first.password),
    beforeMail = await outboxCount();
  await save(admin.http, { registrationRateLimit: { maxAttempts: 3, windowSeconds: 120 } });
  await expect(
    repository.register({ username: first.username, email: first.email, passwordHash }, '000000', {
      accountsRevision: initial.result.meta.revision,
      mailRevision: mail.meta.revision,
      requestId: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  expect(await state(first.username)).toBeUndefined();
  const current = await settings(admin.http),
    second = person();
  // 正常管理操作保存同一可用environment连接，修订变化而SMTP进程始终在线。
  expect(
    (
      await admin.http.write('/api/v1/admin/settings/mail', { mode: 'environment' }, 'PATCH', {
        'If-Match': '"mail-' + mail.meta.revision + '"',
      })
    ).status,
  ).toBe(200);
  await expect(
    repository.register(
      { username: second.username, email: second.email, passwordHash },
      '000000',
      {
        accountsRevision: current.meta.revision,
        mailRevision: mail.meta.revision,
        requestId: randomUUID(),
      },
    ),
  ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  expect(await state(second.username)).toBeUndefined();
  expect(await outboxCount()).toBe(beforeMail);
});
