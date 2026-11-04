import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { seedLegacyUnverified } from '../fixtures/legacy-account.js';
import { mailCode } from '../fixtures/mailpit.js';

it('验证码绑定邮箱，重发和过期拒绝旧码，原账号凭据可继续完成注册', async () => {
  const stack = await createAuthStack();
  try {
    const username = 'legacy_' + randomUUID().replaceAll('-', '').slice(0, 12);
    const account = {
      username,
      email: username + '@fixture.invalid',
      password: 'A previous registration passphrase 2026',
    };
    await seedLegacyUnverified(stack.owner, account);
    const http = stack.browser();
    const issue = () => http.write('/api/v1/auth/register/code', { email: account.email });
    const submit = (code: string, input = account) =>
      http.write('/api/v1/auth/register', { ...input, code });
    expect((await issue()).status).toBe(200);
    const first = await mailCode(account.email, '注册', stack.tick);
    expect((await issue()).status).toBe(200);
    const second = await mailCode(account.email, '注册', stack.tick, [first]);
    expect((await submit(first)).status).toBe(400);
    expect((await submit(second, { ...account, email: 'another-' + account.email })).status).toBe(
      400,
    );
    await stack.owner.pool.query(
      "UPDATE email_verification_codes SET expires_at=clock_timestamp()-interval '1 second'",
    );
    expect((await submit(second)).status).toBe(400);
    expect((await issue()).status).toBe(200);
    const current = await mailCode(account.email, '注册', stack.tick, [first, second]);
    expect(
      (await submit(current, { ...account, password: 'Another valid password 2026' })).status,
    ).toBe(409);
    expect((await submit(current)).status).toBe(200);
    const rows = await stack.owner.pool.query<{ verified: boolean }>(
      'SELECT email_verified_at IS NOT NULL AS verified FROM users WHERE email=$1',
      [account.email],
    );
    expect(rows.rows).toEqual([{ verified: true }]);
  } finally {
    await stack.close();
  }
});
