import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';

test.use({ trace: 'off', screenshot: 'off' });
test('指南阅读、独立文章和管理入口的实际截图基线', async ({ page }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  const phase = process.env['GUIDES_CAPTURE_PHASE'] === 'before' ? 'before' : 'after';
  const directory = join('data/tests/guides-content', phase, info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  const pages = [];
  const root = await page.goto('/guides');
  await expect(page.getByRole('link', { name: '登录', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 1, name: '使用指南', exact: true }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(directory, 'guides.png') });
  await page
    .getByRole('heading', { name: 'MaiBot 使用方式', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(directory, 'maibot-section.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  pages.push({ path: '/guides', status: root?.status() });
  const article = await page.goto('/guides/maibot');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(directory, 'article.png') });
  expect(article?.status()).toBe(phase === 'before' ? 404 : 200);
  pages.push({ path: '/guides/maibot', status: article?.status() });
  await loginBrowserAdmin(page);
  const admin = await page.goto('/admin/guides');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  if (phase === 'after') {
    await expect(
      page.getByRole('heading', { level: 1, name: '指南内容', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /^编辑指南：/ })).toHaveCount(9);
  }
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(directory, 'management.png') });
  expect(admin?.status()).toBe(phase === 'before' ? 404 : 200);
  pages.push({ path: '/admin/guides', status: admin?.status() });
  await writeFile(
    join(directory, 'capture.json'),
    JSON.stringify({ phase, pages, viewport: page.viewportSize() }, null, 2),
  );
});
