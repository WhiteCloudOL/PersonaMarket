import { selectTheme } from '../fixtures/theme.js';
import { selectExploreFilter } from '../fixtures/explore-filters.js';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { AdminPersonaResponseSchema } from '@personamarket/contracts';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { browserWrite, loginCreator } from '../fixtures/browser-account.js';
import { visualPersonas } from '../fixtures/visual-personas.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });
test('首页精选来自真实管理标记，平台切换保留筛选，取消精选后立即退出推荐', async ({
  page,
  browser,
}, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  const baseURL = process.env['PLAYWRIGHT_ORIGIN'];
  if (!baseURL) throw new Error('必须使用隔离测试站点');
  const other = await browser.newContext({ baseURL });
  const phase = process.env['FEATURED_CAPTURE_PHASE'] === 'before' ? 'before' : 'after';
  const directory = join('data/tests/home-featured', phase, info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  try {
    const author = await other.newPage();
    await loginCreator(author);
    await loginBrowserAdmin(page);
    const works = await visualPersonas(author, page);
    async function curate(featured: boolean) {
      const path = '/api/v1/admin/personas/' + works.maibot.id;
      const response = await page.request.get(path);
      expect(response.status()).toBe(200);
      const row = AdminPersonaResponseSchema.parse(await response.json()).data;
      expect(
        (
          await browserWrite(
            page,
            path + '/curation',
            {
              featured,
              official: false,
              expectedRevision: row.revision,
              reason: '核对真实首页精选',
            },
            'PUT',
            { 'Idempotency-Key': randomUUID() },
          )
        ).status(),
      ).toBe(200);
    }
    await curate(true);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect
      .poll(() =>
        page
          .locator('img.home-hero-art')
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    await page.screenshot({ path: join(directory, 'home-top.png') });
    await page.screenshot({ path: join(directory, 'home-full.png'), fullPage: true });
    const selected = page.getByRole('region', { name: '精选人设', exact: true });
    await expect(selected.getByRole('heading', { name: '精选人设', exact: true })).toBeVisible();
    await expect(selected.getByRole('link', { name: works.maibot.title })).toBeVisible();
    await expect(selected.getByRole('link', { name: works.astrbot.title })).toHaveCount(0);
    await expect
      .poll(() =>
        selected
          .locator('img')
          .first()
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
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
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      expect(overflow).toBe(false);
      const target = await selected
        .getByRole('link', { name: '查看全部精选', exact: true })
        .boundingBox();
      expect(target?.height).toBeGreaterThanOrEqual(44);
      measurements.push({ width, height, overflow, targetHeight: target?.height });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: join(directory, width + 'x' + height + '-home.png') });
    }
    await page.setViewportSize(
      info.project.name === 'desktop'
        ? { width: 1440, height: 900 }
        : info.project.name === 'mobile'
          ? { width: 390, height: 844 }
          : { width: 768, height: 1024 },
    );
    await selectTheme(page, 'dark');
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    // 大字区域高于视口时，元素长截图会叠入 sticky Header；用真实视口分别核对标题和操作
    await selected.getByRole('heading', { name: '精选人设', exact: true }).evaluate((element) => {
      const header = document.querySelector('header')?.getBoundingClientRect();
      window.scrollTo(
        0,
        scrollY + element.getBoundingClientRect().top - (header?.height ?? 0) - 24,
      );
    });
    await page.screenshot({ path: join(directory, 'featured-dark-large-type.png') });
    const bookmark = selected.getByRole('button', { name: /收藏/ });
    await bookmark.scrollIntoViewIfNeeded();
    await bookmark.focus();
    await expect(bookmark).toBeInViewport({ ratio: 1 });
    const hit = await bookmark.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return element.contains(
        document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
      );
    });
    expect(hit).toBe(true);
    expect(await page.locator('header').count()).toBe(1);
    await page.screenshot({ path: join(directory, 'featured-dark-large-type-actions.png') });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
    await selectTheme(page, 'light');
    await writeFile(
      join(directory, 'measurements.json'),
      JSON.stringify(
        {
          environment: 'Chromium viewport simulation, 200% root font, no system keyboard',
          measurements,
        },
        null,
        2,
      ),
    );
    await selected.screenshot({ path: join(directory, 'featured-section.png') });
    await selected.getByRole('link', { name: '查看全部精选', exact: true }).click();
    await expect(page).toHaveURL(/featured=true/);
    const results = page.getByRole('region', { name: '人设结果', exact: true });
    await expect(results.getByRole('link', { name: works.maibot.title })).toBeVisible();
    async function selectFeatured(option: string) {
      await selectExploreFilter(page, '精选状态', option);
    }
    await selectFeatured('未设精选');
    await expect(page).toHaveURL(/featured=false/);
    await expect(results.getByRole('link', { name: works.astrbot.title })).toBeVisible();
    await expect(results.getByRole('link', { name: works.maibot.title })).toHaveCount(0);
    await selectFeatured('精选作品');
    await expect(page).toHaveURL(/featured=true/);
    await page
      .getByLabel('人设平台', { exact: true })
      .getByRole('button', { name: 'AstrBot', exact: true })
      .click();
    await expect(page).toHaveURL(/platform=astrbot/);
    expect(new URL(page.url()).searchParams.get('featured')).toBe('true');
    await page.reload();
    await expect(results.getByRole('link', { name: works.astrbot.title })).toHaveCount(0);
    await page.screenshot({ path: join(directory, 'featured-platform-empty.png'), fullPage: true });
    await curate(false);
    await page.goto('/');
    await expect(selected).toHaveCount(0);
    await expect(page.getByRole('link', { name: works.maibot.title })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await selectTheme(page, 'dark');
    await page.screenshot({ path: join(directory, 'home-dark.png') });
  } finally {
    await other.close();
  }
});
