import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

test.use({ trace: 'off', screenshot: 'off' });
test('首页介绍和统计不再提供手动刷新入口', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: /刷新站点介绍|刷新社区统计/ })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '社区统计', exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: '站点介绍', exact: true })
      .getByRole('link', { name: '探索人设', exact: true }),
  ).toBeVisible();
});
test('榜单筛选使用紧凑工具栏，保留触控、键盘、URL和大字可读性', async ({ page }, info) => {
  const directory = join('data/tests/public-toolbar', info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  const sizes =
    info.project.name === 'desktop'
      ? [
          [1366, 768],
          [1440, 900],
          [1920, 1080],
        ]
      : info.project.name === 'tablet'
        ? [
            [768, 1024],
            [960, 800],
            [1024, 768],
          ]
        : [
            [360, 800],
            [390, 844],
            [430, 932],
          ];
  await page.goto('/rankings');
  const toolbar = page.getByLabel('榜单筛选', { exact: true }),
    measurements = [];
  for (const [width = 390, height = 844] of sizes) {
    await page.setViewportSize({ width, height });
    await expect(toolbar).toBeVisible();
    const bounds = await toolbar.boundingBox();
    expect(bounds?.height).toBeLessThanOrEqual(width >= 1024 ? 140 : 250);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    for (const button of await toolbar.getByRole('button').all()) {
      const box = await button.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }
    measurements.push({ width, height, toolbarHeight: bounds?.height });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: join(directory, width + '-rankings.png') });
  }
  const platforms = page.getByRole('group', { name: '人设平台选项', exact: true });
  await platforms.getByRole('button', { name: 'MaiBot', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(page).toHaveURL(/platform=maibot/);
  await expect(platforms.getByRole('button', { name: 'MaiBot', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
    document.documentElement.style.fontSize = '200%';
    scrollTo(0, 0);
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: join(directory, 'dark-large-rankings.png') });
  await writeFile(join(directory, 'measurements.json'), JSON.stringify(measurements, null, 2));
});
test('真实触控仿真可切换平台和时间范围，首页入口可直接使用', async ({ browser }, info) => {
  const context = await browser.newContext({
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const directory = join('data/tests/public-toolbar-touch', info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  try {
    await page.goto('/rankings');
    await page
      .getByRole('group', { name: '人设平台选项', exact: true })
      .getByRole('button', { name: 'AstrBot', exact: true })
      .tap();
    await expect(page).toHaveURL(/platform=astrbot/);
    await page
      .getByRole('group', { name: '榜单类型选项', exact: true })
      .getByRole('button', { name: '下载', exact: true })
      .tap();
    const month = page
      .getByRole('group', { name: '统计范围选项', exact: true })
      .getByRole('button', { name: '近 30 天', exact: true });
    await expect(month).toBeEnabled();
    await month.tap();
    await expect(page).toHaveURL(/window=30d/);
    expect(await page.evaluate(() => matchMedia('(pointer:coarse)').matches)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: join(directory, '390-rankings-touch.png') });
    await page.goto('/');
    await expect(page.getByRole('button', { name: /刷新站点介绍|刷新社区统计/ })).toHaveCount(0);
    await page
      .getByRole('region', { name: '站点介绍', exact: true })
      .getByRole('link', { name: '探索人设', exact: true })
      .tap();
    await expect(page).toHaveURL(/\/explore$/);
  } finally {
    await context.close();
  }
});
