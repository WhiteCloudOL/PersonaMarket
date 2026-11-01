import { moderatePersona } from '../fixtures/admin-persona-moderation.js';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import {
  PublicConfigResponseSchema,
  CreationSettingsResponseSchema,
  MailSettingsResponseSchema,
  AccountSettingsResponseSchema,
  SubmissionResponseSchema,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator, completePersona } from '../fixtures/creator.js';
let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeAll(async () => {
  stack = await createAuthStack();
});
afterAll(async () => {
  await stack?.close();
});
it('MFA 会话超过近期窗口后日常浏览与审核仍可用，高危操作保持近期验证', async () => {
  const admin = await stack.admin();
  const author = await verifiedCreator(stack);
  const persona = await completePersona(author.http);
  const own = await completePersona(admin.http);
  const submit = async (http: typeof admin.http, id: string) =>
    SubmissionResponseSchema.parse(
      await (
        await http.write(
          '/api/v1/me/personas/' + id + '/releases',
          {
            version: '1.0.0',
            expectedDraftRevision: 2,
            changelog: '按风险验证身份',
            confirmed: true,
          },
          'POST',
          { 'Idempotency-Key': randomUUID() },
        )
      ).json(),
    ).data;
  const other = await submit(author.http, persona.id);
  const self = await submit(admin.http, own.id);
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET mfa_verified_at=now()-interval '11 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
    [admin.credentials.username],
  );
  for (const path of [
    '/api/v1/admin/moderation/submissions',
    '/api/v1/admin/moderation/submissions/' + other.id,
    '/api/v1/admin/settings/brand',
    '/api/v1/admin/settings/mail',
    '/api/v1/admin/settings/accounts',
    '/api/v1/admin/settings/creation',
  ])
    expect((await admin.http.raw(path)).status, path).toBe(200);
  const brand = PublicConfigResponseSchema.parse(
    await (await admin.http.raw('/api/v1/admin/settings/brand')).json(),
  );
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/settings/brand',
        { ...brand.data, description: '品牌编辑沿用当前会话' },
        'PATCH',
        { 'If-Match': '"brand-' + brand.meta.revision + '"' },
      )
    ).status,
  ).toBe(200);
  const creation = CreationSettingsResponseSchema.parse(
    await (await admin.http.raw('/api/v1/admin/settings/creation')).json(),
  );
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/settings/creation',
        { data: creation.data, expected: creation.meta },
        'PATCH',
      )
    ).status,
  ).toBe(200);
  const review = (id: string, selfReviewConfirmed = false) =>
    admin.http.write(
      '/api/v1/admin/moderation/submissions/' + id + '/review',
      { action: 'approve', expectedRevision: 1, reason: '已核实来源与内容', selfReviewConfirmed },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
  expect((await review(other.id)).status).toBe(200);
  expect((await review(self.id, true)).status).toBe(403);
  const mail = MailSettingsResponseSchema.parse(
    await (await admin.http.raw('/api/v1/admin/settings/mail')).json(),
  );
  expect(
    (
      await admin.http.write('/api/v1/admin/settings/mail', { mode: 'environment' }, 'PATCH', {
        'If-Match': '"mail-' + mail.meta.revision + '"',
      })
    ).status,
  ).toBe(403);
  const accounts = AccountSettingsResponseSchema.parse(
    await (await admin.http.raw('/api/v1/admin/settings/accounts')).json(),
  );
  expect(
    (
      await admin.http.write('/api/v1/admin/settings/accounts', accounts.data, 'PATCH', {
        'If-Match': '"accounts-' + accounts.meta.revision + '"',
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await moderatePersona(admin.http, persona.id, {
        state: 'blocked',
        reason: '高危处置仍需验证',
      })
    ).status,
  ).toBe(403);
  expect((await admin.http.raw('/api/v1/admin/moderation/submissions')).status).toBe(200);
});
