import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createDatabase } from '@personamarket/database';
import { AuthContextResponseSchema, NotificationsResponseSchema } from '@personamarket/contracts';
import { browserWrite, loginCreator } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';

test.use({ trace: 'off', screenshot: 'off' });
test('业务通知真实调度失败五次后，仅凭运维元数据确认重投并送达本人', async ({
  page,
  browser,
}, info) => {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url || !/^\/pm_e2e_[a-f0-9]{32}_test$/.test(new URL(url).pathname))
    throw new Error('必须使用本次浏览器场景的隔离测试库');
  const database = createDatabase(url),
    context = await browser.newContext({
      baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
      viewport: page.viewportSize(),
    }),
    admin = await context.newPage();
  const directory = join('data/tests/notifications/failures', info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  try {
    const receiver = await loginCreator(page);
    await loginBrowserAdmin(admin);
    const account = AuthContextResponseSchema.parse(
      await (await page.request.get('/api/v1/auth/context')).json(),
    ).data.account;
    if (!account) throw new Error('缺少真实收件账号');
    // 仅隔离库的故障注入：损坏新Outbox信封，真实调度器负责有限重试和失败记录
    await database.pool.query(
      "CREATE FUNCTION corrupt_notification_envelope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.topic='notification.deliver' THEN NEW.payload:=jsonb_set(NEW.payload,'{schemaVersion}','0'::jsonb); END IF; RETURN NEW; END; $$",
    );
    await database.pool.query(
      'CREATE TRIGGER corrupt_notification_envelope BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION corrupt_notification_envelope()',
    );
    const password = 'Notification browser retry passphrase 2026';
    expect(
      (
        await browserWrite(page, '/api/v1/me/security/password', {
          currentPassword: receiver.password,
          newPassword: password,
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await browserWrite(page, '/api/v1/auth/login', { identifier: receiver.username, password })
      ).status(),
    ).toBe(200);
    const row = (
      await database.pool.query<{ id: string; event_id: string }>(
        "SELECT id,event_id FROM notifications WHERE recipient_id=$1 AND kind='account_security'",
        [account.id],
      )
    ).rows[0];
    if (!row) throw new Error('缺少真实密码变更通知');
    for (let attempt = 1; attempt <= 5; attempt++) {
      // 提前本场景下一次计划时间，避免等待真实指数退避；不篡改尝试数或失败状态
      await database.pool.query(
        'UPDATE outbox_events SET available_at=clock_timestamp() WHERE id=$1',
        [row.event_id],
      );
      await expect
        .poll(async () => {
          const status = (
            await database.pool.query<{ attempts: number; done: boolean }>(
              "SELECT attempts,(lease_until IS NULL AND last_error_code='DELIVERY_FAILED') AS done FROM outbox_events WHERE id=$1",
              [row.event_id],
            )
          ).rows[0];
          return status?.done ? status.attempts : 0;
        })
        .toBe(attempt);
    }
    await expect
      .poll(
        async () =>
          (
            await database.pool.query<{ status: string }>(
              'SELECT status FROM notifications WHERE id=$1',
              [row.id],
            )
          ).rows[0]?.status,
      )
      .toBe('failed');
    await database.pool.query('DROP TRIGGER corrupt_notification_envelope ON outbox_events');
    await database.pool.query('DROP FUNCTION corrupt_notification_envelope()');
    await admin.goto('/admin/notifications');
    const opener = admin.getByRole('link', { name: '查看业务通知失败任务', exact: true });
    await opener.click();
    await expect(admin).toHaveURL(/\?failuresPage=1$/);
    const panel = admin.getByRole('dialog', { name: '业务通知失败任务', exact: true });
    await expect(panel).toContainText(receiver.username);
    await expect(panel).toContainText('账号安全');
    await expect(panel).toContainText('本轮失败，详情中核对实际次数');
    await expect(panel).not.toContainText('你的登录密码已更新');
    await expect(panel).not.toContainText(password);
    await admin.reload();
    await expect(panel).toContainText(receiver.username);
    await panel.getByRole('link', { name: '核对投递', exact: true }).click();
    const detail = admin.getByRole('dialog', { name: '通知投递详情', exact: true });
    await detail.getByRole('button', { name: '查看技术详情与口径', exact: true }).click();
    // 损坏的信封不能被当作已匹配的业务事件，先证明未知状态会阻止重投。
    await expect(detail.getByText('当前结果无法核验', { exact: true })).toBeVisible();
    await expect(detail.getByText('分发尝试', { exact: true }).locator('..')).toContainText(
      '未记录',
    );
    await expect(detail.getByRole('button', { name: '重试投递', exact: true })).toHaveCount(0);
    // 仅修复本轮故障注入的 schemaVersion，保留真实累计的五次失败和业务状态。
    const repaired = await database.pool.query(
      "UPDATE outbox_events SET payload=jsonb_set(payload,'{schemaVersion}','1'::jsonb) WHERE id=$1 AND topic='notification.deliver' AND payload->>'notificationId'=$2",
      [row.event_id, row.id],
    );
    expect(repaired.rowCount).toBe(1);
    await detail.getByRole('button', { name: '核对当前投递状态', exact: true }).click();
    await expect(detail.getByText('本轮投递失败', { exact: true })).toBeVisible();
    const technicalDetails = detail.getByRole('button', {
      name: '查看技术详情与口径',
      exact: true,
    });
    if ((await technicalDetails.getAttribute('aria-expanded')) !== 'true')
      await technicalDetails.click();
    await expect(detail.getByText('分发尝试', { exact: true }).locator('..')).toContainText('5 次');
    await expect(detail.getByText('消费执行尝试', { exact: true }).locator('..')).toContainText(
      '未记录',
    );
    await expect(detail).not.toContainText('你的登录密码已更新');
    await expect(detail).not.toContainText(password);
    await admin.screenshot({ path: join(directory, 'failed-metadata.png') });
    const retry = detail.getByRole('button', { name: '重试投递', exact: true });
    await retry.click();
    const confirmation = admin.getByRole('alertdialog', {
      name: '确认重新投递这条通知',
      exact: true,
    });
    await expect(confirmation).toContainText(receiver.username);
    await admin.keyboard.press('Escape');
    await expect(retry).toBeFocused();
    await retry.click();
    await confirmation.getByRole('button', { name: '确认重投', exact: true }).click();
    await expect(
      detail.getByRole('button', { name: '核对当前投递状态', exact: true }),
    ).toBeFocused();
    await expect
      .poll(
        async () =>
          NotificationsResponseSchema.parse(
            await (await page.request.get('/api/v1/me/notifications')).json(),
          ).data.length,
      )
      .toBe(1);
    await detail.getByRole('button', { name: '核对当前投递状态', exact: true }).click();
    await expect(detail.getByText('已送达站内通知', { exact: true })).toBeVisible();
    await detail.getByRole('button', { name: '返回失败任务', exact: true }).click();
    await expect(
      panel.getByText('没有待重投的业务通知；这不代表其他通知均已送达', { exact: true }),
    ).toBeVisible();
    await admin.keyboard.press('Escape');
    await expect(opener).toBeFocused();
    await expect(admin).toHaveURL(/\/admin\/notifications$/);
    await page.goto('/dashboard/notifications');
    await expect(page.getByLabel('通知：账号安全提示', { exact: true })).toBeVisible();
    await expect(page.getByText(password, { exact: true })).toHaveCount(0);
    await page.screenshot({ path: join(directory, 'retried-delivered.png') });
  } finally {
    await database.pool.query(
      'DROP TRIGGER IF EXISTS corrupt_notification_envelope ON outbox_events',
    );
    await database.pool.query('DROP FUNCTION IF EXISTS corrupt_notification_envelope()');
    await context.close();
    await database.close();
  }
});
