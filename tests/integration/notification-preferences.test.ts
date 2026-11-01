import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod';
import {
  SubmissionResponseSchema,
  NotificationPreferencesResponseSchema,
} from '@personamarket/contracts';
import { openSecret } from '@personamarket/server';
import { createDatabase } from '@personamarket/database';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { completePersona, verifiedCreator } from '../fixtures/creator.js';
import { mailText } from '../fixtures/mailpit.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});
const prefs = NotificationPreferencesResponseSchema;
const endpoint = '/api/v1/me/notifications/preferences';
const nonce = () => ({ 'Idempotency-Key': randomUUID() });

it('偏好修订和所有者受数据库约束保护，应用运行账号不能删除设置', async () => {
  const creator = await verifiedCreator(stack),
    other = await verifiedCreator(stack);
  const id = (await creator.http.context()).data.account?.id,
    otherId = (await other.http.context()).data.account?.id;
  expect(
    (await creator.http.write(endpoint, { reviewEmail: false, expectedRevision: 0 }, 'PATCH'))
      .status,
  ).toBe(200);
  await expect(
    stack.owner.pool.query(
      'UPDATE notification_preferences SET revision=revision WHERE user_id=$1',
      [id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    stack.owner.pool.query(
      'UPDATE notification_preferences SET user_id=$2,revision=revision+1 WHERE user_id=$1',
      [id, otherId],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  const application = createDatabase(stack.env.DATABASE_URL);
  try {
    const permission = await application.pool.query<{ allowed: boolean }>(
      "SELECT has_table_privilege(current_user,'notification_preferences','DELETE') AS allowed",
    );
    expect(permission.rows[0]?.allowed).toBe(false);
    await expect(
      application.pool.query('DELETE FROM notification_preferences WHERE user_id=$1', [id]),
    ).rejects.toMatchObject({ code: '42501' });
  } finally {
    await application.close();
  }
  expect(prefs.parse(await (await creator.http.raw(endpoint)).json()).data).toEqual({
    reviewEmail: false,
    revision: 1,
  });
});

it('通知偏好仅本人可读写，默认保持审核邮件，严格契约和CAS防止并发覆盖', async () => {
  const creator = await verifiedCreator(stack),
    other = await verifiedCreator(stack);
  expect((await stack.browser().raw(endpoint)).status).toBe(401);
  const initial = await creator.http.raw(endpoint);
  expect(initial.status).toBe(200);
  expect(prefs.parse(await initial.json())).toEqual({ data: { reviewEmail: true, revision: 0 } });
  const id = (await other.http.context()).data.account?.id;
  expect(
    (
      await creator.http.write(
        endpoint,
        { reviewEmail: false, expectedRevision: 0, userId: id },
        'PATCH',
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await creator.http.write(
        endpoint,
        { reviewEmail: false, expectedRevision: 0, securityEmail: false },
        'PATCH',
      )
    ).status,
  ).toBe(400);
  const concurrent = await Promise.all([
    creator.http.write(endpoint, { reviewEmail: false, expectedRevision: 0 }, 'PATCH'),
    creator.http.write(endpoint, { reviewEmail: true, expectedRevision: 0 }, 'PATCH'),
  ]);
  expect(concurrent.map((response) => response.status).sort()).toEqual([200, 412]);
  expect(prefs.parse(await (await creator.http.raw(endpoint)).json()).data.revision).toBe(1);
  expect(prefs.parse(await (await other.http.raw(endpoint)).json())).toEqual({
    data: { reviewEmail: true, revision: 0 },
  });
});

it('关闭审核邮件实际阻止提交和审核邮件，站内结果与必要密码安全邮件仍真实送达', async () => {
  const creator = await verifiedCreator(stack),
    admin = await stack.admin();
  const disabled = await creator.http.write(
    endpoint,
    { reviewEmail: false, expectedRevision: 0 },
    'PATCH',
  );
  expect(disabled.status).toBe(200);
  expect(prefs.parse(await disabled.json()).data.reviewEmail).toBe(false);
  const mailCount = async () =>
    (
      await stack.owner.pool.query<{ amount: number }>(
        "SELECT count(*)::int AS amount FROM outbox_events WHERE topic='auth.email'",
      )
    ).rows[0]?.amount;
  const before = await mailCount();
  const persona = await completePersona(creator.http);
  const result = await creator.http.write(
    '/api/v1/me/personas/' + persona.id + '/releases',
    {
      version: '1.0.0',
      expectedDraftRevision: persona.revision,
      changelog: '邮件偏好真实验收',
      confirmed: true,
    },
    'POST',
    nonce(),
  );
  expect(result.status).toBe(200);
  const submission = SubmissionResponseSchema.parse(await result.json()).data;
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/moderation/submissions/' + submission.id + '/review',
        {
          action: 'approve',
          expectedRevision: submission.revision,
          reason: '真实审核',
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
      return (
        await stack.owner.pool.query<{ amount: number }>(
          "SELECT count(*)::int AS amount FROM notifications WHERE kind='release_approved' AND status='delivered'",
        )
      ).rows[0]?.amount;
    })
    .toBe(1);
  expect(
    (
      await creator.http.write('/api/v1/me/security/password', {
        currentPassword: creator.password,
        newPassword: 'Preference safety new passphrase 2026',
      })
    ).status,
  ).toBe(200);
  const received = await mailText(creator.email, '你的登录密码已更新', stack.tick);
  expect(received).toContain('所有设备会话');
  const messages = await stack.owner.pool.query<{
    id: string;
    payload: { encryptedMessage: string };
  }>("SELECT id,payload FROM outbox_events WHERE topic='auth.email'");
  const decoded = messages.rows.map((row) =>
    z
      .object({ to: z.string(), subject: z.string() })
      .parse(
        JSON.parse(
          openSecret(stack.env.APP_ENCRYPTION_KEY, 'mail:' + row.id, row.payload.encryptedMessage),
        ),
      ),
  );
  expect(
    decoded
      .filter((message) => message.to === creator.email)
      .some((message) => message.subject.includes('密码已更新')),
  ).toBe(true);
});
