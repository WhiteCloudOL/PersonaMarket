import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { AuthRepository, MetricsRepository } from '@personamarket/api/testing';
import { createAdministrator, createTotp, hashPassword } from '@personamarket/server';
import {
  AccountSettingsResponseSchema,
  AdminUserResponseSchema,
  MailSettingsResponseSchema,
  MfaSetupResponseSchema,
  MfaConfirmResponseSchema,
  SubmissionResponseSchema,
  PublicReleaseResponseSchema,
  ExportPreviewResponseSchema,
  type Platform,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import type { AuthHttp } from '../fixtures/auth-http.js';
import { completePersona, verifiedCreator } from '../fixtures/creator.js';
import { mailToken } from '../fixtures/mailpit.js';
import {
  readSystemSettingsHttp,
  setMaintenance,
  expectMaintenance,
} from '../fixtures/system-maintenance.js';
import { captureTableShape, tableFingerprints } from '../fixtures/table-fingerprints.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});
async function submit(http: AuthHttp, id: string, version: string, key = randomUUID()) {
  const input = {
    version,
    expectedDraftRevision: 2,
    changelog: '维护正常业务版本 ' + version,
    confirmed: true,
  };
  const headers = { 'Idempotency-Key': key },
    path = '/api/v1/me/personas/' + id + '/releases';
  const response = await http.write(path, input, 'POST', headers);
  expect(response.status).toBe(200);
  return { data: SubmissionResponseSchema.parse(await response.json()).data, input, headers, path };
}
async function approve(http: AuthHttp, id: string) {
  const response = await http.write(
    '/api/v1/admin/moderation/submissions/' + id + '/review',
    {
      action: 'approve',
      expectedRevision: 1,
      reason: '核对正常维护业务样例',
      selfReviewConfirmed: false,
    },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(response.status).toBe(200);
  return SubmissionResponseSchema.parse(await response.json()).data;
}
async function releaseState() {
  const shape = await captureTableShape(stack.owner);
  const selected = Object.fromEntries(
    Object.entries(shape).filter(([table]) =>
      /^(?:personas|persona_drafts|persona_releases|release_submissions|asset_references|moderation_records|export_.*)$/u.test(
        table,
      ),
    ),
  );
  const business = await tableFingerprints(stack.owner, selected);
  const outbox = await stack.owner.pool.query(
    'SELECT id,topic,md5(payload::text) AS digest FROM outbox_events ORDER BY id',
  );
  return { business, outbox: outbox.rows };
}

it('注册最终Tx即使已完成策略/SMTP前置准备仍拒绝维护，不留账号token邮件，关闭后显式重试', async () => {
  const admin = await stack.admin(),
    http = stack.browser();
  const accounts = AccountSettingsResponseSchema.parse(
      await (await admin.http.raw('/api/v1/admin/settings/accounts')).json(),
    ),
    mail = MailSettingsResponseSchema.parse(
      await (await admin.http.raw('/api/v1/admin/settings/mail')).json(),
    );
  const username = 'late_' + randomUUID().replaceAll('-', '').slice(0, 12),
    input = {
      username,
      email: username + '@fixture.invalid',
      password: 'A normal late registration passphrase 2026',
    };
  const passwordHash = await hashPassword(input.password);
  await setMaintenance(admin.http, true, '暂时无法提交，请稍后重试');
  const before = await stack.owner.pool.query(
    'SELECT id,topic,md5(payload::text) AS digest FROM outbox_events ORDER BY id',
  );
  expect((await http.context()).data.registrationAvailable).toBe(false);
  await expectMaintenance(await http.write('/api/v1/auth/register/code', { email: input.email }));
  await expect(
    new AuthRepository(stack.owner, stack.env).register(
      { username, email: input.email, passwordHash },
      '000000',
      {
        accountsRevision: accounts.meta.revision,
        mailRevision: mail.meta.revision,
        requestId: randomUUID(),
      },
    ),
  ).rejects.toMatchObject({ code: 'MAINTENANCE_MODE' });
  expect(
    (await stack.owner.pool.query('SELECT id FROM users WHERE username=$1', [username])).rowCount,
  ).toBe(0);
  expect(
    (await stack.owner.pool.query('SELECT scope_hash FROM email_verification_codes')).rowCount,
  ).toBe(0);
  expect(
    (
      await stack.owner.pool.query(
        'SELECT id,topic,md5(payload::text) AS digest FROM outbox_events ORDER BY id',
      )
    ).rows,
  ).toEqual(before.rows);
  await setMaintenance(admin.http, false);
  expect((await http.register(input, stack.tick)).status).toBe(200);
  expect(
    (await http.write('/api/v1/auth/login', { identifier: username, password: input.password }))
      .status,
  ).toBe(200);
  expect((await http.context()).data.account?.emailVerified).toBe(true);
});

it('维护不强退普通会话，显式验证/找回/登录/密码确认与真实MFA管理员恢复均可达', async () => {
  const author = await verifiedCreator(stack),
    username = 'recovery_' + randomUUID().replaceAll('-', '').slice(0, 12),
    password = 'A normal recovery administrator passphrase 2026';
  await createAdministrator(stack.owner, {
    username,
    email: username + '@fixture.invalid',
    password,
  });
  const admin = stack.browser();
  expect((await admin.write('/api/v1/auth/login', { identifier: username, password })).status).toBe(
    200,
  );
  const setup = MfaSetupResponseSchema.parse(
    await (await admin.write('/api/v1/auth/mfa/setup')).json(),
  );
  const confirmation = await admin.write('/api/v1/auth/mfa/confirm', {
    code: createTotp(setup.data.secret, username).generate(),
  });
  expect(confirmation.status).toBe(200);
  const recoveryCode = MfaConfirmResponseSchema.parse(await confirmation.json()).data
    .recoveryCodes[0];
  if (!recoveryCode) throw new Error('缺少本次自建隔离账号的恢复码');
  await setMaintenance(admin, true);
  expect((await author.http.context()).data.account?.username).toBe(author.username);
  expect(
    (await author.http.write('/api/v1/auth/reauthenticate', { currentPassword: author.password }))
      .status,
  ).toBe(200);
  expect(
    (await author.http.write('/api/v1/auth/resend-verification', { email: author.email })).status,
  ).toBe(200);
  expect(
    (await author.http.write('/api/v1/auth/forgot-password', { email: author.email })).status,
  ).toBe(200);
  expect((await mailToken(author.email, 'reset-password', stack.tick)).length).toBe(43);
  const ordinaryLogin = stack.browser();
  expect(
    (
      await ordinaryLogin.write('/api/v1/auth/login', {
        identifier: author.username,
        password: author.password,
      })
    ).status,
  ).toBe(200);
  const recovery = stack.browser();
  expect(
    (await recovery.write('/api/v1/auth/login', { identifier: username, password })).status,
  ).toBe(200);
  expect((await recovery.context()).data.assurance).toBe('mfa_required');
  expect((await recovery.write('/api/v1/auth/mfa/verify', { code: recoveryCode })).status).toBe(
    200,
  );
  expect((await recovery.context()).data.assurance).toBe('authenticated');
  expect((await readSystemSettingsHttp(recovery)).data.maintenanceEnabled).toBe(true);
  await setMaintenance(recovery, false);
  expect((await ordinaryLogin.context()).data.account?.username).toBe(author.username);
});

it('Release所有作者命令及作者admin受门禁，已成功请求可只读核对，恢复后原显式命令成功', async () => {
  const author = await verifiedCreator(stack),
    admin = await stack.admin(),
    persona = await completePersona(author.http),
    ownAdmin = await completePersona(admin.http);
  const published = await submit(author.http, persona.id, '1.0.0');
  await approve(admin.http, published.data.id);
  const pending = await submit(author.http, persona.id, '1.1.0');
  await setMaintenance(admin.http, true);
  const before = await releaseState();
  const same = await author.http.write(pending.path, pending.input, 'POST', pending.headers);
  expect(same.status).toBe(200);
  expect(SubmissionResponseSchema.parse(await same.json()).data.id).toBe(pending.data.id);
  const attempts = [
    () =>
      author.http.write(pending.path, { ...pending.input, version: '1.2.0' }, 'POST', {
        'Idempotency-Key': randomUUID(),
      }),
    () =>
      admin.http.write('/api/v1/me/personas/' + ownAdmin.id + '/releases', pending.input, 'POST', {
        'Idempotency-Key': randomUUID(),
      }),
    () =>
      author.http.write('/api/v1/me/submissions/' + pending.data.id + '/withdraw', {
        expectedRevision: 1,
        reason: '作者撤回正常申请',
      }),
    () =>
      author.http.write('/api/v1/me/personas/' + persona.id + '/restore-submission', {
        submissionId: published.data.id,
        expectedDraftRevision: 2,
        confirmed: true,
      }),
    () =>
      author.http.write('/api/v1/me/personas/' + persona.id + '/visibility', {
        visibility: 'hidden',
        reason: '作者隐藏正常申请',
      }),
    () =>
      author.http.write('/api/v1/me/personas/' + persona.id + '/rollback', {
        releaseId: published.data.releaseId,
        reason: '选择旧公开版本',
      }),
    () =>
      author.http.write(
        '/api/v1/me/personas/' + persona.id + '/releases/' + published.data.releaseId + '/state',
        { action: 'withdraw', reason: '作者撤回版本' },
      ),
  ] as const;
  for (const attempt of attempts) await expectMaintenance(await attempt());
  expect(await releaseState()).toEqual(before);
  expect(
    PublicReleaseResponseSchema.parse(
      await (await stack.browser().raw('/api/v1/personas/' + persona.id)).json(),
    ).data.releaseId,
  ).toBe(published.data.releaseId);
  expect((await author.http.raw('/api/v1/me/personas/' + persona.id + '/releases')).status).toBe(
    200,
  );
  expect((await admin.http.raw('/api/v1/admin/moderation/submissions')).status).toBe(200);
  await setMaintenance(admin.http, false);
  expect((await attempts[2]()).status).toBe(200);
  expect((await attempts[3]()).status).toBe(200);
  expect((await attempts[4]()).status).toBe(200);
  expect(
    (
      await author.http.write('/api/v1/me/personas/' + persona.id + '/visibility', {
        visibility: 'listed',
        reason: '恢复展示',
      })
    ).status,
  ).toBe(200);
  expect((await attempts[5]()).status).toBe(200);
  expect((await attempts[6]()).status).toBe(200);
});

it('正常角色管理授予的moderator可在维护中审核他人，不产生维护旁路角色或额外近期门禁', async () => {
  const author = await verifiedCreator(stack),
    moderator = await verifiedCreator(stack),
    admin = await stack.admin(),
    persona = await completePersona(author.http);
  const target = (await moderator.http.context()).data.account;
  if (!target) throw new Error('缺少隔离审核员');
  const detail = AdminUserResponseSchema.parse(
    await (await admin.http.raw('/api/v1/admin/users/' + target.id)).json(),
  ).data;
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/users/' + target.id + '/role',
        {
          role: 'moderator',
          expectedSecurityVersion: detail.securityVersion,
          reason: '正常指派受控审核员',
        },
        'PUT',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await moderator.http.write('/api/v1/auth/login', {
        identifier: moderator.username,
        password: moderator.password,
      })
    ).status,
  ).toBe(200);
  const pending = await submit(author.http, persona.id, '1.0.0');
  await setMaintenance(admin.http, true);
  await approve(moderator.http, pending.data.id);
  expect(
    PublicReleaseResponseSchema.parse(
      await (await stack.browser().raw('/api/v1/personas/' + persona.id)).json(),
    ).data.releaseId,
  ).toBe(pending.data.releaseId);
});

it.each(['maibot', 'astrbot'] as const)(
  '维护中%s的所有下载格式与最终记账拒绝，HEAD/预览可读且无指标或匿名标识',
  async (platform: Platform) => {
    const author = await verifiedCreator(stack),
      admin = await stack.admin(),
      persona = await completePersona(author.http, platform),
      published = await submit(author.http, persona.id, '1.0.0');
    await approve(admin.http, published.data.id);
    await setMaintenance(admin.http, true);
    const visitor = stack.browser(),
      base = '/api/v1/personas/' + persona.id + '/releases/' + published.data.releaseId;
    const formats = [
      'text',
      'markdown',
      platform === 'maibot' ? 'maibot-toml' : 'astrbot-json',
      'market-json',
      'market-zip',
    ];
    const before = await releaseState();
    for (const format of formats) {
      await expectMaintenance(await visitor.raw(base + '/export?format=' + format));
      const preview = await visitor.raw(base + '/export-preview?format=' + format);
      expect(preview.status).toBe(200);
      ExportPreviewResponseSchema.parse(await preview.json());
      const head = await visitor.raw(base + '/export?format=' + format, { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe('');
    }
    await expect(
      new MetricsRepository(stack.owner).record({
        personaId: persona.id,
        releaseId: published.data.releaseId,
        format: 'text',
        day: new Date().toISOString().slice(0, 10),
        subjectHash: 'a'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'MAINTENANCE_MODE' });
    expect([...visitor.cookies.keys()].some((key) => key.includes('export-subject'))).toBe(false);
    expect(await releaseState()).toEqual(before);
    await setMaintenance(admin.http, false);
    for (const format of formats) {
      const response = await visitor.raw(base + '/export?format=' + format);
      expect(response.status).toBe(200);
      expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
    }
    expect(
      (
        await stack.owner.pool.query(
          'SELECT total_count FROM export_daily_metrics WHERE persona_id=$1',
          [persona.id],
        )
      ).rows,
    ).toEqual([{ total_count: 1 }]);
  },
);
