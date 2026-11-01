import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { AuthContextResponseSchema, NotificationsResponseSchema } from '@personamarket/contracts';
import { loginCreator, browserWrite } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { accountNavigationItem, closeAccountNavigation } from '../fixtures/account-navigation.js';

test.use({ trace: 'off', screenshot: 'off' });
test('九个视口、深色大字和有限高度的通知布局', async ({ page, browser }, info) => {
  const receiver = await loginCreator(page),
    context = await browser.newContext({
      baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
      viewport: page.viewportSize(),
    }),
    admin = await context.newPage();
  const directory = join('data/tests/notifications/layout', info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  admin.on('pageerror', (error) => errors.push(error.message));
  try {
    await loginBrowserAdmin(admin);
    const account = AuthContextResponseSchema.parse(
      await (await page.request.get('/api/v1/auth/context')).json(),
    ).data.account;
    if (!account) throw new Error('缺少真实收件账号');
    const title = '需要认真阅读的重要站内通知'.repeat(8),
      message =
        '长中文通知内容和换行\n'.repeat(25) +
        'https://fixture.invalid/' +
        'long-notification-context_'.repeat(40);
    expect(
      (
        await browserWrite(
          admin,
          '/api/v1/admin/notifications',
          { recipientId: account.id, title, message, confirmed: true },
          'POST',
          { 'Idempotency-Key': randomUUID() },
        )
      ).status(),
    ).toBe(200);
    await expect
      .poll(
        async () =>
          NotificationsResponseSchema.parse(
            await (await page.request.get('/api/v1/me/notifications')).json(),
          ).data.length,
      )
      .toBe(1);
    let formInitialized = false;
    const sizes =
      info.project.name === 'desktop'
        ? [
            [1366, 768],
            [1440, 900],
            [1920, 1080],
          ]
        : info.project.name === 'mobile'
          ? [
              [360, 800],
              [390, 844],
              [430, 932],
            ]
          : [
              [768, 1024],
              [960, 800],
              [1024, 768],
            ];
    const measurements = [];
    for (const [width = 390, height = 844] of sizes) {
      for (const target of [page, admin]) await target.setViewportSize({ width, height });
      await page.goto('/dashboard/notifications');
      await expect(page.getByLabel('通知：' + title, { exact: true })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: join(directory, width + '-inbox.png') });
      const read = page.getByRole('button', { name: '全部已读', exact: true });
      expect((await read.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      if (!formInitialized) {
        await admin.goto('/admin/notifications');
        await admin.getByRole('tab', { name: '写通知', exact: true }).click();
        await admin.getByLabel('收件用户名', { exact: true }).fill(receiver.username);
        await admin.getByRole('button', { name: '查找收件人', exact: true }).click();
        await expect(admin.getByRole('status')).toContainText('已核对收件人');
        await admin.getByLabel('通知标题', { exact: true }).fill(title);
        await admin.getByLabel('通知内容', { exact: true }).fill(message);
        await admin
          .getByRole('checkbox', { name: '我已核对收件账号和通知内容', exact: true })
          .check();
        formInitialized = true;
      }
      await admin.evaluate(() => document.fonts.ready);
      expect(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const body = admin.getByLabel('通知内容', { exact: true });
      const measurement = await body.evaluate((element) => ({
        width: innerWidth,
        height: innerHeight,
        textarea: element.getBoundingClientRect().height,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        overflow: getComputedStyle(element).overflowY,
      }));
      expect(measurement.textarea).toBeLessThanOrEqual(height * 0.4 + 2);
      expect(measurement.scrollHeight).toBeGreaterThan(measurement.clientHeight);
      expect(measurement.overflow).toBe('auto');
      const submit = admin.getByRole('button', { name: '创建通知', exact: true });
      await expect(submit).toBeEnabled();
      expect((await submit.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      measurements.push(measurement);
      await admin.evaluate(() => window.scrollTo(0, 0));
      await expect.poll(() => admin.evaluate(() => scrollY)).toBe(0);
      await admin.screenshot({ path: join(directory, width + '-management.png') });
      await admin.screenshot({
        path: join(directory, width + '-management-full.png'),
        fullPage: true,
      });
    }
    for (const target of [page, admin]) {
      await target.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
      await target.evaluate(() => {
        document.documentElement.classList.add('dark');
        document.documentElement.style.fontSize = '200%';
      });
      expect(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await page.screenshot({ path: join(directory, 'dark-large-inbox.png') });
    await admin.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => admin.evaluate(() => scrollY)).toBe(0);
    await admin.screenshot({ path: join(directory, 'dark-large-management.png') });
    await admin.screenshot({
      path: join(directory, 'dark-large-management-full.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: '打开账号菜单', exact: true }).click();
    const largeMenu =
      (page.viewportSize()?.width ?? 0) < 1024
        ? page.getByRole('dialog', { name: '账号导航', exact: true })
        : page.getByRole('menu');
    await expect(largeMenu).toBeVisible();
    const largeBounds = await largeMenu.boundingBox();
    expect(largeBounds?.x).toBeGreaterThanOrEqual(0);
    expect((largeBounds?.x ?? 0) + (largeBounds?.width ?? 0)).toBeLessThanOrEqual(
      page.viewportSize()?.width ?? 0,
    );
    await page.screenshot({ path: join(directory, 'dark-large-menu.png') });
    await page.keyboard.press('Escape');
    await admin.setViewportSize({ width: 390, height: 480 });
    await admin.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
    await admin.getByLabel('通知内容', { exact: true }).focus();
    await admin.keyboard.press('Control+End');
    const submit = admin.getByRole('button', { name: '创建通知', exact: true });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport();
    await admin.screenshot({ path: join(directory, '390-short-height.png') });
    const entry = await accountNavigationItem(admin, '通知管理');
    await entry.scrollIntoViewIfNeeded();
    await expect(entry).toBeInViewport();
    expect((await entry.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await closeAccountNavigation(admin);
    await expect(admin.getByRole('button', { name: '打开账号菜单', exact: true })).toBeFocused();
    expect(errors).toEqual([]);
    await writeFile(
      join(directory, 'measurements.json'),
      JSON.stringify(
        {
          measurements,
          errors,
          physicalDevice: false,
          systemKeyboard: false,
          nativeBrowserZoom: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await context.close();
  }
});
