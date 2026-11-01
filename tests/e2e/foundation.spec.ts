import { selectTheme } from '../fixtures/theme.js';
import { expect, test, type Page } from '@playwright/test';
import {
  PublicConfigResponseSchema,
  PublicStatisticsResponseSchema,
} from '@personamarket/contracts';
import { createDatabase } from '@personamarket/database';

const url = process.env['TEST_DATABASE_URL'];
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw new Error('E2E 必须使用独立测试数据库。');
const database = createDatabase(url);
let original: unknown;
test.beforeAll(async () => {
  original = (
    await database.pool.query<{ value: unknown }>(
      "SELECT value FROM site_settings WHERE key = 'brand'",
    )
  ).rows[0]?.value;
});
test.beforeEach(async ({ page }) => {
  await page.clock.install();
  await database.pool.query(
    "UPDATE site_settings SET value = $1::jsonb, revision = revision + 1 WHERE key = 'brand'",
    [
      JSON.stringify({
        name: '端到端验证·人设市场',
        description: '通过真实 API 从 PostgreSQL 读取的测试配置',
        defaultLocale: 'zh-CN',
      }),
    ],
  );
});
async function reconnectAfterFreshnessWindow(page: Page) {
  await expect(
    page
      .getByRole('navigation', { name: '账号导航', exact: true })
      .getByRole('link', { name: '登录', exact: true }),
  ).toBeVisible();
  // 按顺序执行加载后的回调与新鲜期计时器，避免直接跳时把迟到的初始化记在31秒之后。
  await page.clock.runFor(31_000);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
}
test.afterAll(async () => {
  try {
    await database.pool.query(
      "UPDATE site_settings SET value = $1::jsonb, revision = revision + 1 WHERE key = 'brand'",
      [JSON.stringify(original)],
    );
  } finally {
    await database.close();
  }
});

test('数据库 → API → SSR，键盘与深浅色主题', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const response = await page.request.get('/api/v1/public/config');
  const config = PublicConfigResponseSchema.parse(await response.json());
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(config.data.name);
  const statisticsResponse = await page.request.get('/api/v1/public/statistics');
  expect(statisticsResponse.ok()).toBe(true);
  const statistics = PublicStatisticsResponseSchema.parse(await statisticsResponse.json());
  const statisticsRegion = page.getByRole('region', { name: '社区统计' });
  for (const key of ['personas', 'creators', 'exports'] as const)
    await expect(statisticsRegion.getByTestId('stat-' + key)).toHaveText(
      new Intl.NumberFormat('zh-CN').format(statistics.data[key]),
    );
  await expect(page.getByRole('button', { name: /刷新站点介绍|刷新社区统计/ })).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: '跳至主要内容' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await page.screenshot({ path: info.outputPath('foundation-light.png'), fullPage: true });
  await selectTheme(page, 'dark');
  await expect(page.locator('html')).toHaveClass('dark');
  await page.reload();
  await expect(page.locator('html')).toHaveClass('dark');
  await page.screenshot({ path: info.outputPath('foundation-dark.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('统计读取失败保留最近计数，连接恢复后自动重试', async ({ page }) => {
  await page.goto('/');
  const region = page.getByRole('region', { name: '社区统计' });
  await expect(region.getByTestId('stat-personas')).toBeVisible();
  const before = await region.getByTestId('stat-personas').textContent();
  await page.route('**/api/v1/public/statistics', (route) => route.abort('failed'));
  await reconnectAfterFreshnessWindow(page);
  await expect(region.getByRole('alert')).toContainText('社区统计暂时无法更新');
  await expect(region.getByTestId('stat-personas')).toHaveText(before ?? '');
  await page.unroute('**/api/v1/public/statistics');
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect(region.getByRole('alert')).toHaveCount(0);
});

test('重新打开页面读取真实变更，长内容不造成横向溢出', async ({ page }) => {
  await page.goto('/');
  const name = '长名称检查-' + 'ABCD'.repeat(17);
  await database.pool.query(
    "UPDATE site_settings SET value = value || $1::jsonb, revision = revision + 1 WHERE key = 'brand'",
    [JSON.stringify({ name, description: '长中文描述'.repeat(30) })],
  );
  await page.reload();
  await expect(
    page.getByRole('region', { name: '站点介绍' }).getByText(name, { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('请求失败保留最近配置，回到页面自动重试', async ({ page }) => {
  await page.goto('/');
  const region = page.getByRole('region', { name: '站点介绍' });
  const current = PublicConfigResponseSchema.parse(
    await (await page.request.get('/api/v1/public/config')).json(),
  ).data;
  await expect(region.getByRole('heading', { level: 1 })).toHaveText(current.name);
  let attempts = 0;
  await page.route('**/api/v1/public/config', (route) => {
    attempts++;
    return route.abort('failed');
  });
  await reconnectAfterFreshnessWindow(page);
  const alert = region.getByRole('alert');
  await expect(alert).toContainText('站点介绍暂时无法更新');
  expect(attempts).toBe(2);
  await expect(region.getByRole('heading', { level: 1 })).toHaveText(current.name);
  await expect(region.getByText(current.description, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '刷新站点介绍' })).toHaveCount(0);
  const updated = {
    name: '连接恢复后的真实站点',
    description: '连接中断期间在隔离数据库更新的介绍',
  };
  await database.pool.query(
    "UPDATE site_settings SET value = value || $1::jsonb, revision = revision + 1 WHERE key = 'brand'",
    [JSON.stringify(updated)],
  );
  await page.unroute('**/api/v1/public/config');
  const recovered = page.waitForResponse(
    (response) => response.url().endsWith('/api/v1/public/config') && response.status() === 200,
  );
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await recovered;
  await expect(alert).toHaveCount(0);
  await expect(region.getByRole('heading', { level: 1 })).toHaveText(updated.name);
  await expect(region.getByText(updated.description, { exact: true })).toBeVisible();
});
