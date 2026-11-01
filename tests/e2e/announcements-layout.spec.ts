import { selectTheme } from '../fixtures/theme.js';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { AdminAnnouncementResponseSchema } from '@personamarket/contracts';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { loginCreator } from '../fixtures/browser-account.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });
test('公告长内容在重点视口可读，保留历史返回输入，确认框和等待状态可用', async ({
  page,
  browser,
}, info) => {
  const baseURL = process.env['PLAYWRIGHT_ORIGIN'];
  if (!baseURL) throw new Error('必须使用隔离测试站点');
  const directory = join('data/tests/announcements-layout', info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  const context = await browser.newContext({ baseURL });
  const reader = await context.newPage();
  let release: (() => void) | undefined;
  try {
    await reader.goto('/admin/announcements');
    await expect(reader.getByRole('heading', { name: '请先登录', exact: true })).toBeVisible();
    await loginCreator(reader);
    await reader.goto('/admin/announcements');
    await expect(
      reader.getByRole('heading', { name: '你没有公告管理权限', exact: true }),
    ).toBeVisible();
    expect((await reader.request.get('/api/v1/admin/announcements')).status()).toBe(403);
    await loginBrowserAdmin(page);
    await page.goto('/admin/announcements');
    await page.getByRole('button', { name: '新建公告', exact: true }).click();
    const panel = page.getByRole('dialog', { name: '管理公告', exact: true });
    const title = '星光创作提醒'.repeat(20);
    const body = 'https://example.invalid/' + 'long-original-story-'.repeat(600) + '\n保留末尾提醒';
    await panel.getByLabel('公告标题', { exact: true }).fill(title);
    await panel.getByLabel('简短摘要', { exact: true }).fill('给创作者的一封温柔来信'.repeat(10));
    await panel.getByLabel('公告正文', { exact: true }).fill(body);
    await panel.getByLabel('处理理由', { exact: true }).fill('通过真实表单建立长内容公告');
    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith('/admin/announcements') && response.request().method() === 'POST',
    );
    await panel.getByRole('button', { name: '创建编辑稿', exact: true }).click();
    const response = await created;
    expect(response.status()).toBe(200);
    const row = AdminAnnouncementResponseSchema.parse(await response.json()).data;
    await expect(panel).not.toBeVisible();
    await page.getByRole('searchbox', { name: '搜索标题或 ID', exact: true }).fill(row.id);
    await page.getByRole('button', { name: '筛选公告', exact: true }).click();
    await page.waitForURL((url) => url.searchParams.get('q') === row.id);
    const trigger = page.getByRole('button', { name: '管理公告', exact: true });
    await expect(trigger).toHaveCount(1);
    await trigger.click();
    await panel.getByLabel('处理理由', { exact: true }).fill('核对长内容后发布');
    await panel.getByRole('button', { name: '准备发布公告', exact: true }).click();
    const confirmation = page.getByRole('alertdialog');
    await confirmation.getByRole('button', { name: '确认处理', exact: true }).click();
    await expect(panel).not.toBeVisible();
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
      await page.setViewportSize({ width, height });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: join(directory, width + 'x' + height + '-admin.png') });
      await trigger.click();
      await expect(panel.getByLabel('公告正文', { exact: true })).toHaveValue(body);
      const measured = await panel.evaluate((element) => ({
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
        panelOverflow: element.scrollWidth > element.clientWidth,
        labelHeight:
          element.querySelector('label[for="announcement-pinned"]')?.getBoundingClientRect()
            .height ?? 0,
      }));
      expect(measured).toMatchObject({ pageOverflow: false, panelOverflow: false });
      expect(measured.labelHeight).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: join(directory, width + 'x' + height + '-panel.png') });
      await page.keyboard.press('Escape');
      await expect(panel).not.toBeVisible();
      await expect(trigger).toBeFocused();
      await reader.setViewportSize({ width, height });
      await reader.goto('/announcements/' + row.id);
      await expect(
        reader.getByRole('heading', { level: 1, name: title, exact: true }),
      ).toBeVisible();
      const publicOverflow = await reader.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      );
      expect(publicOverflow).toBe(false);
      await reader.screenshot({ path: join(directory, width + 'x' + height + '-public.png') });
      measurements.push({ width, height, ...measured, publicOverflow });
    }
    const primary =
      info.project.name === 'desktop'
        ? { width: 1440, height: 900 }
        : info.project.name === 'mobile'
          ? { width: 390, height: 844 }
          : { width: 768, height: 1024 };
    await page.setViewportSize(primary);
    await selectTheme(page, 'dark');
    await trigger.click();
    const reason = '浏览器返回后保留本次核对 https://example.invalid/' + '星光'.repeat(700);
    await panel.getByLabel('处理理由', { exact: true }).fill(reason);
    await page.goBack();
    await expect(panel).not.toBeVisible();
    await page.goForward();
    await expect(panel.getByLabel('处理理由', { exact: true })).toHaveValue(reason);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await panel.getByRole('button', { name: '准备归档公告', exact: true }).click();
    await expect(
      confirmation.getByRole('heading', { name: '确认归档公告', exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(
      confirmation.getByRole('button', { name: '确认处理', exact: true }),
    ).toBeInViewport({ ratio: 1 });
    expect(
      await confirmation.evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(false);
    await page.screenshot({ path: join(directory, 'dark-large-confirmation.png') });
    const review = confirmation.getByRole('region', { name: '公告操作预览', exact: true });
    await review.focus();
    await page.keyboard.press('End');
    expect(await review.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await confirmation.getByRole('button', { name: '返回核对', exact: true }).click();
    await expect(panel.getByLabel('处理理由', { exact: true })).toHaveValue(reason);
    const endpoint = '**/api/v1/admin/announcements/' + row.id + '/archive';
    const continuation: { resume?: () => void } = {};
    const gate = new Promise<void>((resolve) => {
      continuation.resume = resolve;
    });
    let intercepted = false;
    release = () => {
      if (!continuation.resume) throw new Error('归档请求等待器尚未就绪');
      continuation.resume();
    };
    await page.route(endpoint, async (route) => {
      intercepted = true;
      await gate;
      await route.continue();
    });
    await panel.getByRole('button', { name: '准备归档公告', exact: true }).click();
    await confirmation.getByRole('button', { name: '确认处理', exact: true }).click();
    await expect(confirmation).not.toBeVisible();
    await expect.poll(() => intercepted).toBe(true);
    await expect(panel.getByRole('button', { name: '关闭面板', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(panel).toBeVisible();
    release();
    await expect(panel).not.toBeVisible();
    await page.unroute(endpoint);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
    await trigger.click();
    await expect(panel.getByLabel('公告标题', { exact: true })).toBeDisabled();
    await panel.getByLabel('处理理由', { exact: true }).fill('恢复后仍保留编辑稿');
    await panel.getByRole('button', { name: '准备恢复公告', exact: true }).click();
    await confirmation.getByRole('button', { name: '确认处理', exact: true }).click();
    await expect(panel).not.toBeVisible();
    await trigger.click();
    await panel.getByLabel('处理理由', { exact: true }).fill('恢复后由管理员明确重新发布');
    await panel.getByRole('button', { name: '准备发布公告', exact: true }).click();
    await confirmation.getByRole('button', { name: '确认处理', exact: true }).click();
    await expect(panel).not.toBeVisible();
    await reader.setViewportSize(primary);
    await reader.reload();
    await selectTheme(reader, 'dark');
    await reader.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    expect(await reader.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await reader.screenshot({ path: join(directory, 'dark-large-public.png') });
    await writeFile(
      join(directory, 'measurements.json'),
      JSON.stringify(
        {
          environment: 'Chromium viewport simulation and 200% root font; no physical keyboard/IME',
          measurements,
        },
        null,
        2,
      ),
    );
  } finally {
    release?.();
    await context.close();
  }
});
