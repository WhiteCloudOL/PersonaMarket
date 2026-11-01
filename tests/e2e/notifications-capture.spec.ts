import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { loginCreator } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { accountNavigationItem, closeAccountNavigation } from '../fixtures/account-navigation.js';

test.use({ trace: 'off', screenshot: 'off' });
test('通知工作区和账号入口截图', async ({ page, browser }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  const context = await browser.newContext({
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    viewport: page.viewportSize(),
  });
  const admin = await context.newPage();
  const phase = process.env['NOTIFICATIONS_CAPTURE_PHASE'] === 'before' ? 'before' : 'after';
  const directory = join('data/tests/notifications', phase, info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  try {
    await loginCreator(page);
    await loginBrowserAdmin(admin);
    await expect(await accountNavigationItem(page, '我的收藏')).toBeVisible();
    await page.screenshot({ path: join(directory, 'account-menu.png') });
    await closeAccountNavigation(page);
    const own = await page.goto('/dashboard/notifications');
    expect(own?.status()).toBe(phase === 'before' ? 404 : 200);
    if (phase === 'after') {
      await expect(page.getByRole('heading', { name: '我的通知', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '刷新通知', exact: true })).toBeEnabled();
      await expect(page.getByText('0 条未读', { exact: true })).toBeVisible();
      await expect(page.getByText('暂时没有通知', { exact: true })).toBeVisible();
    }
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(directory, 'inbox.png') });
    const management = await admin.goto('/admin/notifications');
    expect(management?.status()).toBe(phase === 'before' ? 404 : 200);
    if (phase === 'after') {
      await expect(admin.getByRole('heading', { name: '站内通知管理', exact: true })).toBeVisible();
      await expect(admin.getByText('没有符合条件的投递记录', { exact: true })).toBeVisible();
    }
    await admin.evaluate(() => document.fonts.ready);
    await admin.screenshot({ path: join(directory, 'management.png') });
    await writeFile(
      join(directory, 'capture.json'),
      JSON.stringify(
        { viewport: page.viewportSize(), own: own?.status(), management: management?.status() },
        null,
        2,
      ),
    );
  } finally {
    await context.close();
  }
});
