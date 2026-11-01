import { selectTheme } from '../fixtures/theme.js';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { loginCreator } from '../fixtures/browser-account.js';
import { visualPersonas } from '../fixtures/visual-personas.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });
test('长作品名的管理列表和面板在重点视口、深色及大字下保持可操作', async ({
  page,
  browser,
}, info) => {
  const baseURL = process.env['PLAYWRIGHT_ORIGIN'];
  if (!baseURL) throw new Error('必须使用隔离测试站点');
  const context = await browser.newContext({ baseURL });
  const author = await context.newPage();
  const directory = join('data/tests/admin-persona-layout', info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  const viewports =
    info.project.name === 'desktop'
      ? [
          { width: 1366, height: 768 },
          { width: 1440, height: 900 },
          { width: 1920, height: 1080 },
        ]
      : info.project.name === 'mobile'
        ? [
            { width: 360, height: 800 },
            { width: 390, height: 844 },
            { width: 430, height: 932 },
          ]
        : [
            { width: 768, height: 1024 },
            { width: 960, height: 800 },
            { width: 1024, height: 768 },
          ];
  const measurements: Array<{
    viewport: string;
    theme: string;
    overflow: boolean;
    panelOverflow: boolean;
    labelHeight: number;
  }> = [];
  try {
    await page.goto('/admin/personas');
    await expect(
      page.getByRole('heading', { level: 1, name: '请先登录', exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: join(directory, 'guest.png') });
    await loginBrowserAdmin(page);
    await loginCreator(author);
    await author.goto('/admin/personas');
    await expect(
      author.getByRole('heading', { level: 1, name: '你没有人设管理权限', exact: true }),
    ).toBeVisible();
    expect((await author.request.get('/api/v1/admin/personas')).status()).toBe(403);
    await author.screenshot({ path: join(directory, 'forbidden.png') });
    const title = '原创星光故事的漫长旅程和温柔回响'.repeat(5);
    const works = await visualPersonas(author, page, { titles: { maibot: title } });
    for (const viewport of viewports) {
      const key = viewport.width + 'x' + viewport.height;
      await page.setViewportSize(viewport);
      await page.goto('/admin/personas?q=' + works.maibot.id);
      const trigger = page.getByRole('button', { name: '管理这条人设', exact: true });
      await expect(trigger).toBeVisible();
      await page.screenshot({ path: join(directory, key + '-list.png'), fullPage: true });
      await trigger.click();
      const panel = page.getByRole('dialog', { name: '管理人设', exact: true });
      await expect(
        panel.getByRole('heading', { level: 2, name: title, exact: true }),
      ).toBeVisible();
      const measured = await panel.evaluate((element) => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        panelOverflow: element.scrollWidth > element.clientWidth,
        labelHeight: element.querySelector('label')?.getBoundingClientRect().height ?? 0,
      }));
      expect(measured).toEqual({
        overflow: false,
        panelOverflow: false,
        labelHeight: expect.any(Number),
      });
      expect(measured.labelHeight).toBeGreaterThanOrEqual(44);
      measurements.push({ viewport: key, theme: 'light', ...measured });
      await page.screenshot({ path: join(directory, key + '-detail.png') });
      await page.keyboard.press('Escape');
      await expect(panel).not.toBeVisible();
      await expect(trigger).toBeFocused();
    }
    const primary =
      info.project.name === 'desktop'
        ? { width: 1440, height: 900 }
        : info.project.name === 'mobile'
          ? { width: 390, height: 844 }
          : { width: 768, height: 1024 };
    await page.setViewportSize(primary);
    await selectTheme(page, 'dark');
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await page.getByRole('button', { name: '管理这条人设', exact: true }).click();
    const panel = page.getByRole('dialog', { name: '管理人设', exact: true });
    const reason = '需核对的长链接：https://example.invalid/' + '星光'.repeat(800);
    await panel.getByLabel('上下架理由', { exact: true }).fill(reason);
    await panel.getByRole('button', { name: '准备下架人设', exact: true }).click();
    const confirmation = page.getByRole('alertdialog');
    await expect(confirmation.getByRole('button', { name: '确认处理', exact: true })).toBeVisible();
    const overflow = await confirmation.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        page: document.documentElement.scrollWidth > innerWidth,
        horizontal: element.scrollWidth > element.clientWidth,
        inside:
          rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
      };
    });
    expect(overflow).toEqual({ page: false, horizontal: false, inside: true });
    await page.screenshot({ path: join(directory, 'dark-large-type-confirmation.png') });
    await expect(
      confirmation.getByRole('heading', { name: '确认下架这条人设', exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(
      confirmation.getByRole('button', { name: '确认处理', exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await confirmation.getByRole('button', { name: '返回核对', exact: true }).click();
    await expect(panel.getByLabel('上下架理由', { exact: true })).toHaveValue(reason);
    await panel.getByLabel('上下架理由', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(directory, 'dark-large-type-input.png') });
    await panel.getByLabel('上下架理由', { exact: true }).fill('');
    page.once('dialog', (dialog) => dialog.accept());
    await panel.getByRole('button', { name: '关闭管理面板', exact: true }).click();
    await expect(panel).not.toBeVisible();
    await page.getByRole('checkbox', { name: '选择' + title, exact: true }).check();
    await page.getByRole('button', { name: '管理所选人设', exact: true }).click();
    const bulk = page.getByRole('dialog', { name: '批量管理人设', exact: true });
    await bulk.getByLabel('批量处理理由', { exact: true }).fill('大字下核对本批操作');
    await bulk.getByRole('button', { name: '核对本批操作', exact: true }).click();
    await bulk
      .getByRole('button', { name: '确认执行本批操作', exact: true })
      .scrollIntoViewIfNeeded();
    const bulkOverflow = await bulk.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    );
    await page.screenshot({ path: join(directory, 'dark-large-type-bulk.png') });
    expect(bulkOverflow).toBe(false);
    await writeFile(
      join(directory, 'measurements.json'),
      JSON.stringify(
        {
          environment: 'Chromium viewport simulation; 200% root font size',
          measurements,
          largeTypeConfirmation: overflow,
          largeTypeBulkOverflow: bulkOverflow,
        },
        null,
        2,
      ),
    );
  } finally {
    await context.close();
  }
});
