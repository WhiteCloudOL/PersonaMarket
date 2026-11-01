import { selectTheme } from '../fixtures/theme.js';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

test.use({ trace: 'off', screenshot: 'off' });
const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];
for (const viewport of viewports)
  test(`文档与创作表单布局 ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const evidence = join(
      'data/tests/guides-reading-matrix',
      viewport.width.toString(),
      randomUUID(),
    );
    await mkdir(evidence, { recursive: true });
    const metrics: unknown[] = [];
    async function measure(label: string) {
      const value = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(value.scrollWidth).toBeLessThanOrEqual(value.width);
      metrics.push({ label, ...value });
    }
    await page.goto('/guides');
    await expect(page.getByRole('article', { name: '使用指南', exact: true })).toBeVisible();
    await measure('guide-top');
    await page.screenshot({ path: join(evidence, 'top.png') });
    if (viewport.width < 1024) {
      const trigger = page.getByRole('button', { name: '打开文档目录', exact: true });
      await trigger.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.screenshot({ path: join(evidence, 'contents.png') });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
    await selectTheme(page, 'dark');
    if (viewport.width < 1024)
      await page.getByRole('button', { name: '打开文档目录', exact: true }).click();
    const link = page
      .getByRole('navigation', { name: '文档目录', exact: true })
      .getByRole('link', { name: '导入文件', exact: true });
    expect(
      await link.evaluate((element) => element.getBoundingClientRect().height),
    ).toBeGreaterThanOrEqual(44);
    await link.click();
    const heading = page.getByRole('heading', { name: '导入文件', exact: true });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
    const rect = await heading.boundingBox();
    expect(rect?.y).toBeGreaterThanOrEqual(viewport.width < 1024 ? 108 : 80);
    await measure('import-dark');
    await page.screenshot({ path: join(evidence, 'import-dark.png') });
    await page.goto('/guides#license');
    await expect(page.getByRole('heading', { name: '开源许可', exact: true })).toBeInViewport();
    await page.screenshot({ path: join(evidence, 'license-dark.png') });
    await page.goto('/guides#credits');
    await expect(page.getByRole('heading', { name: '开源致谢', exact: true })).toBeInViewport();
    await measure('credits-dark');
    await page.screenshot({ path: join(evidence, 'credits-dark.png') });
    if (viewport.width === 390 || viewport.width === 1440) {
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      await measure('guide-200-percent');
      await page.screenshot({ path: join(evidence, 'large-type.png') });
    }
    await page.goto('/dashboard/personas/new');
    await expect(page.getByLabel('作者使用说明', { exact: true })).toBeVisible();
    await expect(
      page.locator('#create-persona-form').getByRole('button', { name: /^复制/ }),
    ).toHaveCount(0);
    await page.getByLabel('作者使用说明', { exact: true }).scrollIntoViewIfNeeded();
    await measure('creator-origin');
    await page.screenshot({ path: join(evidence, 'origin-dark.png') });
    await writeFile(join(evidence, 'metrics.json'), JSON.stringify(metrics, null, 2));
  });
