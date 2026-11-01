import { selectTheme } from '../fixtures/theme.js';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { TaxonomyManagementDetailResponseSchema } from '@personamarket/contracts';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { browserWrite, loginCreator } from '../fixtures/browser-account.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });
for (const kind of ['category', 'tag'] as const) {
  const plural = kind === 'category' ? 'categories' : 'tags';
  const label = kind === 'category' ? '分类' : '标签';
  test(
    label + '管理覆盖权限、重试、历史返回、长内容和重点视口',
    async ({ page, browser }, info) => {
      const directory = join('data/tests/taxonomy-layout', info.project.name, kind, randomUUID());
      await mkdir(directory, { recursive: true });
      const baseURL = process.env['PLAYWRIGHT_ORIGIN'];
      if (!baseURL) throw new Error('必须使用隔离测试站点');
      const other = await browser.newContext({ baseURL });
      try {
        await page.goto('/admin/' + plural);
        await expect(page.getByRole('heading', { name: '请先登录', exact: true })).toBeVisible();
        const author = await other.newPage();
        await loginCreator(author);
        await author.goto('/admin/' + plural);
        await expect(
          author.getByRole('heading', { name: '你没有目录管理权限', exact: true }),
        ).toBeVisible();
        expect((await author.request.get('/api/v1/admin/' + plural)).status()).toBe(403);
        await loginBrowserAdmin(page);
        const name = '星光创作故事'.repeat(12) + randomUUID().slice(0, 8);
        const created = await browserWrite(
          page,
          '/api/v1/admin/' + plural,
          { name, active: true, sortOrder: -90, reason: '隔离测试目录，核对长名称和双端操作' },
          'POST',
          { 'Idempotency-Key': randomUUID() },
        );
        expect(created.status()).toBe(200);
        const row = TaxonomyManagementDetailResponseSchema.parse(await created.json()).data;
        const endpoint = '**/api/v1/admin/' + plural + '?*';
        await page.route(endpoint, (route) => route.abort('failed'));
        await page.goto('/admin/' + plural + '?q=' + row.id);
        await expect(page.getByRole('button', { name: '重试读取目录', exact: true })).toBeVisible();
        await page.unroute(endpoint);
        await page.getByRole('button', { name: '重试读取目录', exact: true }).click();
        const trigger = page.getByRole('button', { name: '管理条目', exact: true });
        await expect(trigger).toBeVisible();
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
        const panel = page.getByRole('dialog', { name: '管理' + label, exact: true });
        const measurements = [];
        for (const [width = 390, height = 844] of sizes) {
          await page.setViewportSize({ width, height });
          // Sheet 关闭会恢复先前滚动位置，固定到页首避免长截图把 sticky Header 拼在正文中间
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({
            path: join(directory, width + 'x' + height + '-list.png'),
          });
          await page.screenshot({
            path: join(directory, width + 'x' + height + '-list-full.png'),
            fullPage: true,
          });
          await trigger.click();
          await expect(panel.getByLabel('名称', { exact: true })).toHaveValue(name);
          const measured = await panel.evaluate((element) => ({
            pageOverflow: document.documentElement.scrollWidth > innerWidth,
            panelOverflow: element.scrollWidth > element.clientWidth,
            targetHeight:
              element.querySelector('label[for="taxonomy-active"]')?.getBoundingClientRect()
                .height ?? 0,
          }));
          expect(measured).toMatchObject({ pageOverflow: false, panelOverflow: false });
          expect(measured.targetHeight).toBeGreaterThanOrEqual(44);
          measurements.push({ width, height, ...measured });
          await page.screenshot({ path: join(directory, width + 'x' + height + '-detail.png') });
          await page.keyboard.press('Escape');
          await expect(panel).not.toBeVisible();
          await expect(trigger).toBeFocused();
        }
        await selectTheme(page, 'dark');
        await trigger.click();
        const input = panel.getByLabel('处理理由', { exact: true });
        const reason = '保留浏览器返回前的输入 https://example.invalid/' + '星光'.repeat(800);
        await input.fill(reason);
        await page.goBack();
        await expect(panel).not.toBeVisible();
        await page.goForward();
        await expect(input).toHaveValue(reason);
        const primary =
          info.project.name === 'desktop'
            ? { width: 1440, height: 900 }
            : info.project.name === 'mobile'
              ? { width: 390, height: 844 }
              : { width: 768, height: 1024 };
        await page.setViewportSize(primary);
        await page.evaluate(() => {
          document.documentElement.style.fontSize = '200%';
        });
        await panel.getByRole('button', { name: '归档条目', exact: true }).click();
        const confirmation = page.getByRole('alertdialog');
        await expect(
          confirmation.getByRole('heading', { name: '确认归档条目', exact: true }),
        ).toBeInViewport({ ratio: 1 });
        await expect(
          confirmation.getByRole('button', { name: '确认处理', exact: true }),
        ).toBeInViewport({ ratio: 1 });
        expect(
          await confirmation.evaluate((element) => element.scrollWidth > element.clientWidth),
        ).toBe(false);
        await page.screenshot({ path: join(directory, 'dark-large-type-confirmation.png') });
        await confirmation.getByRole('button', { name: '返回核对', exact: true }).click();
        await expect(input).toHaveValue(reason);
        await expect(panel.getByRole('button', { name: '归档条目', exact: true })).toBeFocused();
        await input.scrollIntoViewIfNeeded();
        await input.focus();
        await expect(input).toBeInViewport({ ratio: 1 });
        await page.screenshot({ path: join(directory, 'dark-large-type-input.png') });
        await writeFile(
          join(directory, 'measurements.json'),
          JSON.stringify(
            {
              environment:
                'Chromium viewport simulation; 200% root font size; no physical keyboard test',
              measurements,
            },
            null,
            2,
          ),
        );
      } finally {
        await other.close();
      }
    },
  );
}
