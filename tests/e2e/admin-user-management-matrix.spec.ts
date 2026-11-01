import { selectTheme } from '../fixtures/theme.js';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { loginCreator } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { visualPersonas } from '../fixtures/visual-personas.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });
const contexts: BrowserContext[] = [];
let admin: Page;
let username: string;
const evidence = join('data/tests/admin-user-management-matrix', randomUUID());
test.beforeAll(async ({ browser }) => {
  const options = { baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100' };
  const adminContext = await browser.newContext(options);
  contexts.push(adminContext);
  const authorContext = await browser.newContext(options);
  contexts.push(authorContext);
  admin = await adminContext.newPage();
  const author = await authorContext.newPage();
  await loginBrowserAdmin(admin);
  username = (await loginCreator(author)).username;
  await visualPersonas(author, admin);
  await mkdir(evidence, { recursive: true });
});
test.afterAll(async () => {
  await Promise.all(contexts.map((context) => context.close()));
});

for (const [width, height] of [
  [360, 800],
  [390, 844],
  [430, 932],
  [768, 1024],
  [1024, 768],
  [1366, 768],
  [1440, 900],
  [1920, 1080],
] as const) {
  test(`用户管理 ${width}×${height} 分类与内容无溢出且触控可达`, async () => {
    await admin.setViewportSize({ width, height });
    const metrics: unknown[] = [];
    for (const theme of width === 390 || width === 1440 ? ['light', 'dark'] : ['light']) {
      await admin.goto('/admin/users?q=' + username);
      await expect(admin.getByRole('heading', { name: '用户管理', exact: true })).toBeVisible();
      await selectTheme(admin, theme === 'dark' ? 'dark' : 'light');
      if (theme === 'dark') await expect(admin.locator('html')).toHaveClass(/dark/);
      else await expect(admin.locator('html')).not.toHaveClass(/dark/);
      await admin.getByRole('button', { name: '管理 ' + username, exact: true }).click();
      const panel = admin.getByRole('dialog', { name: '用户详情', exact: true });
      for (const view of ['管理操作', '公开作品', '审核记录']) {
        const tab = panel.getByRole('tab', { name: view, exact: true });
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        if (view === '公开作品')
          await expect(panel.getByText('共 2 个当前公开作品', { exact: true })).toBeVisible();
        if (view === '公开作品')
          await expect
            .poll(() =>
              panel.evaluate((element) =>
                Array.from(element.querySelectorAll('img'))
                  .filter((image) => {
                    const rect = image.getBoundingClientRect();
                    return (
                      rect.width > 0 && rect.height > 0 && rect.top < innerHeight && rect.bottom > 0
                    );
                  })
                  .every((image) => image.complete && image.naturalWidth > 0),
              ),
            )
            .toBe(true);
        if (view === '审核记录')
          await expect(
            panel.getByRole('link', { name: '查看版本审核', exact: true }).first(),
          ).toBeVisible();
        const bounds = await tab.boundingBox();
        if (!bounds) throw new Error('分类控件不可见');
        expect(bounds.height).toBeGreaterThanOrEqual(44);
        expect(bounds.width).toBeGreaterThanOrEqual(44);
        const layout = await panel.evaluate((element) => ({
          width: element.clientWidth,
          scrollWidth: element.scrollWidth,
          pageWidth: innerWidth,
          pageScrollWidth: document.documentElement.scrollWidth,
        }));
        expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
        expect(layout.pageScrollWidth).toBeLessThanOrEqual(layout.pageWidth);
        metrics.push({ theme, view, ...layout, tab: bounds });
        await admin.screenshot({ path: join(evidence, `${width}-${height}-${theme}-${view}.png`) });
      }
    }
    await writeFile(
      join(evidence, `${width}-${height}.json`),
      JSON.stringify({ width, height, metrics }, null, 2),
    );
  });
}
