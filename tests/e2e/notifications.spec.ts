import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  AdminNoticesResponseSchema,
  AuthContextResponseSchema,
  NotificationsResponseSchema,
} from '@personamarket/contracts';
import { loginCreator, browserWrite } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { accountNavigationItem, closeAccountNavigation } from '../fixtures/account-navigation.js';

test.use({ trace: 'off', screenshot: 'off' });
test('管理员真实发送、响应丢失幂等重试、收件箱未读和跨账号隔离', async ({
  page,
  browser,
}, info) => {
  const receiver = await loginCreator(page);
  const account = AuthContextResponseSchema.parse(
    await (await page.request.get('/api/v1/auth/context')).json(),
  ).data.account;
  if (!account) throw new Error('缺少真实收件账号');
  const context = await browser.newContext({
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    viewport: page.viewportSize(),
  });
  const admin = await context.newPage();
  const directory = join('data/tests/notifications/flow', info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  try {
    await loginBrowserAdmin(admin);
    await admin.goto('/admin/notifications');
    await admin.getByRole('tab', { name: '写通知', exact: true }).click();
    await admin.getByLabel('收件用户名', { exact: true }).fill(receiver.username);
    await admin.getByRole('button', { name: '查找收件人', exact: true }).click();
    await expect(admin.getByRole('status')).toContainText('已核对收件人：' + receiver.username);
    const title = '真实站内通知 ' + randomUUID().slice(0, 8),
      message =
        '保留原始通知文本\n<script>window.notificationXss=1</script>\n' +
        'https://fixture.invalid/long-path-'.repeat(15);
    await admin.getByLabel('通知标题', { exact: true }).fill(title);
    await admin.getByLabel('通知内容', { exact: true }).fill(message);
    await admin.getByRole('checkbox', { name: '我已核对收件账号和通知内容', exact: true }).check();
    await admin.getByRole('tab', { name: '投递记录', exact: true }).click();
    await admin.getByRole('tab', { name: '写通知', exact: true }).click();
    await expect(admin.getByLabel('通知标题', { exact: true })).toHaveValue(title);
    await expect(admin.getByLabel('通知内容', { exact: true })).toHaveValue(message);
    await expect(
      admin.getByRole('checkbox', { name: '我已核对收件账号和通知内容', exact: true }),
    ).toBeChecked();
    await admin.route(
      '**/api/v1/admin/notifications',
      async (route) => {
        const result = await route.fetch();
        expect(result.status()).toBe(200);
        await route.abort('connectionreset');
      },
      { times: 1 },
    );
    await admin.getByRole('button', { name: '创建通知', exact: true }).click();
    await expect(
      admin.getByText('通知服务暂时不可用，请核对结果后重试，当前输入已保留', { exact: true }),
    ).toBeVisible();
    await expect(admin.getByLabel('通知标题', { exact: true })).toHaveValue(title);
    await expect(admin.getByLabel('通知内容', { exact: true })).toHaveValue(message);
    await admin.screenshot({ path: join(directory, 'send-retry.png'), fullPage: true });
    await admin.getByRole('button', { name: '创建通知', exact: true }).click();
    await expect(
      admin.getByText('通知已创建，真实投递状态可在记录中查看', { exact: true }),
    ).toBeVisible();
    await expect(admin.getByLabel('通知内容', { exact: true })).toHaveValue('');
    const history = AdminNoticesResponseSchema.parse(
      await (
        await admin.request.get('/api/v1/admin/notifications?recipientId=' + account.id)
      ).json(),
    );
    expect(history.meta.total).toBe(1);
    const recipientId = history.data[0]?.recipient.id;
    expect(recipientId).toBe(account.id);
    if (!recipientId) throw new Error('缺少通知收件账号');
    expect(
      (
        await browserWrite(
          admin,
          '/api/v1/admin/notifications',
          { recipientId, title: '第二条真实提醒', message: '用于核对全部已读', confirmed: true },
          'POST',
          { 'Idempotency-Key': randomUUID() },
        )
      ).status(),
    ).toBe(200);
    await page.goto('/dashboard/notifications');
    await expect
      .poll(
        async () =>
          NotificationsResponseSchema.parse(
            await (await page.request.get('/api/v1/me/notifications')).json(),
          ).data.length,
      )
      .toBe(2);
    await page.getByRole('button', { name: '刷新通知', exact: true }).click();
    const card = page.getByLabel('通知：' + title, { exact: true });
    await card.getByRole('button', { name: '展开完整通知', exact: true }).click();
    await expect(card).toContainText(message);
    await expect(page.getByText('2 条未读', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => 'notificationXss' in window)).toBe(false);
    await page.screenshot({ path: join(directory, 'unread.png'), fullPage: true });
    await card.getByRole('button', { name: '标为已读', exact: true }).click();
    await expect(page.getByText('1 条未读', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '全部已读', exact: true }).click();
    await expect(page.getByText('0 条未读', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '只看未读', exact: true }).click();
    await expect(page).toHaveURL(/status=unread/);
    await expect(page.getByText('没有未读通知', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('0 条未读', { exact: true })).toBeVisible();
    const notificationsEntry = await accountNavigationItem(page, '我的通知');
    await expect(notificationsEntry).toContainText('0 未读');
    await expect(notificationsEntry).toHaveAccessibleDescription('0 未读');
    await closeAccountNavigation(page);
    const logout = await browserWrite(page, '/api/v1/auth/logout');
    expect(logout.status()).toBe(200);
    await loginCreator(page);
    await page.goto('/dashboard/notifications');
    await expect(page.getByText('暂时没有通知', { exact: true })).toBeVisible();
    await expect(page.getByText(title, { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await context.close();
  }
});
test('未登录和无权限状态可见，读取失败可重试且不会显示伪成功', async ({ page }) => {
  await page.goto('/dashboard/notifications');
  await expect(page.getByText('请先登录', { exact: true })).toBeVisible();
  await loginCreator(page);
  await page.goto('/admin/notifications');
  await expect(page.getByText('你没有通知管理权限', { exact: true })).toBeVisible();
  expect((await page.request.get('/api/v1/admin/notifications')).status()).toBe(403);
  await page.route('**/api/v1/me/notifications?**', (route) => route.abort('connectionreset'), {
    times: 1,
  });
  await page.goto('/dashboard/notifications');
  await expect(page.getByRole('button', { name: '重试读取通知', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重试读取通知', exact: true }).click();
  await expect(page.getByText('暂时没有通知', { exact: true })).toBeVisible();
  await expect(
    page.getByText('已读状态已更新，后来送达的通知保持未读', { exact: true }),
  ).toHaveCount(0);
});
