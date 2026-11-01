import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { loginCreator } from '../fixtures/browser-account.js';

test.use({ trace: 'off', screenshot: 'off' });
test('模型建议管理和创作字段的真实截图基线', async ({ page, browser }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  const phase = process.env['MODEL_SUGGESTIONS_CAPTURE_PHASE'] === 'before' ? 'before' : 'after';
  const directory = join('data/tests/model-suggestions', phase, info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  await loginBrowserAdmin(page);
  const response = await page.goto('/admin/settings/model-suggestions');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  if (phase === 'after')
    await expect(page.getByRole('button', { name: '添加模型建议', exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(directory, 'management.png') });
  expect(response?.status()).toBe(phase === 'before' ? 404 : 200);
  const context = await browser.newContext({ viewport: page.viewportSize() });
  try {
    const author = await context.newPage();
    await loginCreator(author);
    await author.goto('/dashboard/personas/new');
    await author.getByRole('heading', { name: '推荐模型', exact: true }).scrollIntoViewIfNeeded();
    await author.evaluate(() => document.fonts.ready);
    await author.screenshot({ path: join(directory, 'creator.png') });
    await author
      .locator('#recommended-models')
      .screenshot({ path: join(directory, 'model-fields.png') });
    expect(
      await author.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  } finally {
    await context.close();
  }
  await writeFile(
    join(directory, 'capture.json'),
    JSON.stringify({ phase, status: response?.status(), viewport: page.viewportSize() }, null, 2),
  );
});
