import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { MfaSetupResponseSchema, SubmissionResponseSchema } from '@personamarket/contracts';
import { createAdministrator, createTotp } from '@personamarket/server';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { completePersona } from '../fixtures/creator.js';
import type { AuthHttp } from '../fixtures/auth-http.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});
async function administrator() {
  const username = 'self_' + randomUUID().replaceAll('-', '').slice(0, 12);
  const password = 'Self review fixture administrator passphrase 2026';
  await createAdministrator(stack.owner, {
    username,
    email: username + '@fixture.invalid',
    password,
  });
  const http = stack.browser();
  expect((await http.write('/api/v1/auth/login', { identifier: username, password })).status).toBe(
    200,
  );
  expect((await http.context()).data.mfaEnabled).toBe(false);
  return { username, http };
}
async function submission(http: AuthHttp) {
  const persona = await completePersona(http);
  const response = await http.write(
    '/api/v1/me/personas/' + persona.id + '/releases',
    {
      version: '1.0.0',
      expectedDraftRevision: persona.revision,
      changelog: '核验管理员自审身份策略',
      confirmed: true,
    },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(response.status).toBe(200);
  return SubmissionResponseSchema.parse(await response.json()).data;
}
function review(
  http: AuthHttp,
  id: string,
  key: string,
  confirmed = true,
  reason = '核实本人作品后明确自审',
) {
  return http.write(
    '/api/v1/admin/moderation/submissions/' + id + '/review',
    { action: 'approve', expectedRevision: 1, reason, selfReviewConfirmed: confirmed },
    'POST',
    { 'Idempotency-Key': key },
  );
}

it('管理员可自审，仍须明确确认和理由，重复成功只记一次审计', async () => {
  const actor = await administrator();
  const pending = await submission(actor.http);
  const key = randomUUID();
  expect((await review(actor.http, pending.id, key, false)).status).toBe(403);
  expect((await review(actor.http, pending.id, key, true, '')).status).toBe(403);
  const response = await review(actor.http, pending.id, key);
  expect(response.status).toBe(200);
  expect(SubmissionResponseSchema.parse(await response.json()).data.status).toBe('APPROVED');
  expect((await review(actor.http, pending.id, key)).status).toBe(200);
  const records = await stack.owner.pool.query(
    'SELECT id FROM moderation_records WHERE submission_id=$1 AND self_review=true',
    [pending.id],
  );
  expect(records.rowCount).toBe(1);
});

it.each([false, true])('较早的有效会话可以直接编辑、投稿和自审（MFA=%s）', async (mfa) => {
  const actor = await administrator();
  if (mfa) {
    const setupResponse = await actor.http.write('/api/v1/auth/mfa/setup');
    expect(setupResponse.status).toBe(200);
    const setup = MfaSetupResponseSchema.parse(await setupResponse.json()).data;
    const confirmation = await actor.http.write('/api/v1/auth/mfa/confirm', {
      code: createTotp(setup.secret, actor.username).generate(),
    });
    expect(confirmation.status).toBe(200);
  }
  const original = await stack.owner.pool.query<{ id: string }>(
    "UPDATE auth_sessions SET created_at=now()-interval '11 minutes',mfa_verified_at=now()-interval '11 minutes' WHERE revoked_at IS NULL AND user_id=(SELECT id FROM users WHERE username=$1) RETURNING id",
    [actor.username],
  );
  expect(original.rowCount).toBe(1);
  const pending = await submission(actor.http);
  const result = await review(actor.http, pending.id, randomUUID());
  expect(result.status).toBe(200);
  expect(SubmissionResponseSchema.parse(await result.json()).data.status).toBe('APPROVED');
  expect((await actor.http.context()).data.mfaEnabled).toBe(mfa);
  const active = await stack.owner.pool.query(
    'SELECT id FROM auth_sessions WHERE id=$1 AND revoked_at IS NULL',
    [original.rows[0]?.id],
  );
  expect(active.rowCount).toBe(1);
});
