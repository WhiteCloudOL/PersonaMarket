import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createSystemQueue, createTotp, openSecret } from '@personamarket/server';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator } from '../fixtures/creator.js';
import { NotificationsResponseSchema, ErrorResponseSchema } from '@personamarket/contracts';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});
it('业务通知的失败任务只暴露运维元数据，管理员确认重投后本人仅收到一次原通知', async () => {
  const receiver = await verifiedCreator(stack),
    admin = await stack.admin();
  expect(
    (
      await receiver.http.write('/api/v1/me/security/password', {
        currentPassword: receiver.password,
        newPassword: 'Business notification retry passphrase 2026',
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await receiver.http.write('/api/v1/auth/login', {
        identifier: receiver.username,
        password: 'Business notification retry passphrase 2026',
      })
    ).status,
  ).toBe(200);
  const row = (
    await stack.owner.pool.query<{ id: string; event_id: string }>(
      "SELECT n.id,n.event_id FROM notifications n JOIN users u ON u.id=n.recipient_id WHERE u.username=$1 AND n.kind='account_security'",
      [receiver.username],
    )
  ).rows[0];
  if (!row) throw new Error('缺少真实密码变更通知');
  const queue = createSystemQueue(stack.env.REDIS_URL, stack.worker.name);
  try {
    await stack.owner.pool.query(
      "CREATE FUNCTION reject_business_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.consumer='notifications' THEN RAISE EXCEPTION 'CONTROLLED_FAILURE' USING ERRCODE='23514'; END IF; RETURN NEW; END; $$",
    );
    await stack.owner.pool.query(
      'CREATE TRIGGER reject_business_notification BEFORE INSERT ON processed_events FOR EACH ROW EXECUTE FUNCTION reject_business_notification()',
    );
    const job = await queue.add(
      'notification.deliver',
      { schemaVersion: 1, notificationId: row.id, eventId: row.event_id },
      { jobId: row.event_id, attempts: 5, removeOnFail: false },
    );
    await expect.poll(() => job.getState()).toBe('failed');
    await stack.owner.pool.query('DROP TRIGGER reject_business_notification ON processed_events');
    await stack.owner.pool.query('DROP FUNCTION reject_business_notification()');
    const response = await admin.http.raw('/api/v1/admin/notifications/failures/list');
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(JSON.stringify(body)).toContain(row.id);
    expect(JSON.stringify(body)).not.toMatch(
      /message|title|target|sourceId|eventId|password|email/,
    );
    expect((await receiver.http.raw('/api/v1/admin/notifications/failures/list')).status).toBe(403);
    const path = '/api/v1/admin/notifications/failures/' + row.id + '/retry',
      key = { 'Idempotency-Key': randomUUID() },
      command = { expectedRevision: 1, confirmed: true };
    const expire = () =>
      stack.owner.pool.query(
        "UPDATE auth_sessions SET created_at=now()-interval '20 minutes',mfa_verified_at=now()-interval '20 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
        [admin.credentials.username],
      );
    await expire();
    const denied = await admin.http.write(path, command, 'POST', key);
    expect(denied.status).toBe(403);
    expect(ErrorResponseSchema.parse(await denied.json()).error.code).toBe('MFA_REQUIRED');
    expect(
      (
        await admin.http.write('/api/v1/auth/reauthenticate', {
          currentPassword: admin.credentials.password,
        })
      ).status,
    ).toBe(403);
    const identity = (await admin.http.context()).data.account;
    if (!identity) throw new Error('管理员会话缺失');
    const mfa = await stack.owner.pool.query<{ encrypted_secret: string }>(
      'SELECT encrypted_secret FROM user_mfa WHERE user_id=$1',
      [identity.id],
    );
    const encrypted = mfa.rows[0]?.encrypted_secret;
    if (!encrypted) throw new Error('受控MFA缺失');
    const secret = openSecret(stack.env.APP_ENCRYPTION_KEY, 'mfa:' + identity.id, encrypted);
    expect(
      (
        await admin.http.write('/api/v1/auth/mfa/verify', {
          code: createTotp(secret, admin.credentials.username).generate({
            timestamp: Date.now() + 30000,
          }),
        })
      ).status,
    ).toBe(200);
    expect((await admin.http.write(path, command, 'POST', key)).status).toBe(200);
    expect((await admin.http.write(path, command, 'POST', key)).status).toBe(200);
    expect(
      (await admin.http.write(path, command, 'POST', { 'Idempotency-Key': randomUUID() })).status,
    ).toBe(412);
    await expect
      .poll(async () => {
        await stack.tick();
        return NotificationsResponseSchema.parse(
          await (await receiver.http.raw('/api/v1/me/notifications')).json(),
        ).data.length;
      })
      .toBe(1);
    expect(
      (
        await stack.owner.pool.query(
          'SELECT count(*)::int AS amount FROM notifications WHERE recipient_id=(SELECT id FROM users WHERE username=$1)',
          [receiver.username],
        )
      ).rows[0]?.amount,
    ).toBe(1);
    await expire();
    const replay = await admin.http.write(path, command, 'POST', key);
    expect(replay.status).toBe(403);
    expect(ErrorResponseSchema.parse(await replay.json()).error.code).toBe('MFA_REQUIRED');
  } finally {
    await queue.close();
  }
});
