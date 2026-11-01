import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';

test.use({ trace: 'off', screenshot: 'off' });
test('触控环境可核对收件人并提交长通知', async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const directory = join('data/tests/notifications/touch', randomUUID());
  await mkdir(directory, { recursive: true });
  try {
    const admin = await loginBrowserAdmin(page);
    await page.goto('/admin/notifications');
    await page.getByRole('tab', { name: '写通知', exact: true }).tap();
    await page.getByLabel('收件用户名', { exact: true }).fill(admin.username);
    await page.getByRole('button', { name: '查找收件人', exact: true }).tap();
    await expect(page.getByRole('status')).toContainText('已核对收件人');
    await page.getByLabel('通知标题', { exact: true }).fill('触控提交的真实通知');
    await page.getByLabel('通知内容', { exact: true }).fill('长内容仍可滚动阅读\n'.repeat(50));
    await page.getByText('我已核对收件账号和通知内容', { exact: true }).tap();
    await expect(
      page.getByRole('checkbox', { name: '我已核对收件账号和通知内容', exact: true }),
    ).toBeChecked();
    const submit = page.getByRole('button', { name: '创建通知', exact: true });
    expect((await submit.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await submit.tap();
    await expect(
      page.getByText('通知已创建，真实投递状态可在记录中查看', { exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => matchMedia('(pointer:coarse)').matches)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: join(directory, '390-touch-submitted.png'), fullPage: true });
  } finally {
    await context.close();
  }
});
