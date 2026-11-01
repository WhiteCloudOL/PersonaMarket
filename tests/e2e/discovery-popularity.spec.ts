import { selectExploreFilter } from '../fixtures/explore-filters.js';
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loginCreator, browserWrite } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { visualPersonas } from '../fixtures/visual-personas.js';
import { rankingDatabase } from '../fixtures/rankings.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });
let authorContext: BrowserContext;
let reviewerContext: BrowserContext;
let author: Page;
let works: Awaited<ReturnType<typeof visualPersonas>>;

test.beforeAll(async ({ browser }) => {
  const options = { baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100' };
  authorContext = await browser.newContext(options);
  reviewerContext = await browser.newContext(options);
  author = await authorContext.newPage();
  const reviewer = await reviewerContext.newPage();
  await loginCreator(author);
  await loginBrowserAdmin(reviewer);
  works = await visualPersonas(author, reviewer, {
    titles: { maibot: '晴野诗织 · ' + 'CreativeStoryGarden'.repeat(3) },
    summary: '在书页间记录中文故事，认真倾听每一次相遇与创作的灵感'.repeat(4),
  });
  const first = await browser.newContext(options);
  const second = await browser.newContext(options);
  try {
    const download = async (
      context: BrowserContext,
      work: { id: string; releaseId: string },
      format: string,
    ) => {
      const response = await context.request.get(
        '/api/v1/personas/' + work.id + '/releases/' + work.releaseId + '/export?format=' + format,
      );
      expect(response.status()).toBe(200);
      await response.body();
    };
    await download(authorContext, works.maibot, 'text');
    await download(first, works.maibot, 'text');
    await download(first, works.maibot, 'markdown');
    await download(second, works.maibot, 'text');
    await download(first, works.astrbot, 'text');
  } finally {
    await first.close();
    await second.close();
  }
});

test.afterAll(async () => {
  try {
    if (works)
      for (const work of [works.maibot, works.astrbot])
        expect(
          (
            await browserWrite(author, '/api/v1/me/personas/' + work.id + '/visibility', {
              visibility: 'hidden',
              reason: '完成隔离排序浏览器验收',
            })
          ).status(),
        ).toBe(200);
  } finally {
    await reviewerContext?.close();
    await authorContext?.close();
  }
});

test.beforeEach(async ({ page }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
});

async function chooseSort(page: Page, label: string, value: string, keyboard = false) {
  const trigger = page.getByRole('combobox', { name: '结果排序', exact: true });
  expect((await trigger.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  if (keyboard) {
    await trigger.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('option', { name: label, exact: true }).focus();
    await page.keyboard.press('Enter');
  } else {
    await trigger.click();
    await page.getByRole('option', { name: label, exact: true }).click();
  }
  await expect(page).toHaveURL(new RegExp('sort=' + value));
  await expect(page.locator('fieldset[aria-busy]')).toHaveAttribute('aria-busy', 'false');
  await expect(trigger).toContainText(label);
}

async function capture(page: Page, info: TestInfo, name: string) {
  await expect(page.locator('fieldset[aria-busy]')).toHaveAttribute('aria-busy', 'false');
  await page.evaluate(() => document.fonts.ready);
  for (const image of await page.locator('#main img').all()) {
    if (!(await image.isVisible())) continue;
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        image.evaluate(
          (element) =>
            element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0,
        ),
      )
      .toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const clipped = await page
    .getByRole('region', { name: '人设结果' })
    .locator('[data-slot="card-title"], [data-slot="card-description"], [data-slot="badge"]')
    .evaluateAll((elements) =>
      elements.flatMap((element) => {
        if (!(element instanceof HTMLElement)) return [];
        const card = element.closest('[data-slot="card"]');
        return card &&
          (element.getBoundingClientRect().right > card.getBoundingClientRect().right + 1 ||
            element.scrollWidth > element.clientWidth + 1)
          ? [element.textContent?.slice(0, 48)]
          : [];
      }),
    );
  const size = page.viewportSize();
  if (!size) throw new Error('缺少真实浏览器视口');
  const directory = join('data/tests/discovery-popularity/current', `${size.width}x${size.height}`);
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: join(directory, name), fullPage: true });
  await info.attach(name, { path: join(directory, name), contentType: 'image/png' });
  expect(clipped).toEqual([]);
}

test('真实导出计数、近期热度和分享地址可用，键盘排序保留焦点与长文本', async ({ page }, info) => {
  // 桌面项目另串行截图7个断点；单次交互仍使用既有10秒限制
  test.setTimeout(60000);
  await page.goto('/explore');
  const results = page.getByRole('region', { name: '人设结果' });
  const cards = results.locator('a[href^="/personas/"]');
  await expect(cards).toHaveCount(2);
  await chooseSort(page, '有效导出', 'downloads', true);
  await expect(cards.first()).toHaveAttribute('href', '/personas/' + works.maibot.id);
  await expect(cards.first()).toContainText('累计有效导出 2');
  await expect(cards.last()).toContainText('累计有效导出 1');
  await expect(page.getByRole('combobox', { name: '结果排序', exact: true })).toBeFocused();
  await capture(page, info, 'downloads-light.png');
  await chooseSort(page, '近7天导出', 'recent-downloads');
  await expect(cards.first()).toContainText('近7天有效导出 2');
  await page.reload();
  await expect(cards.first()).toContainText('近7天有效导出 2');
  await chooseSort(page, '近期热度', 'hot');
  await expect(cards.first()).toContainText('互动热度');
  await expect(cards.first()).toContainText('有效点赞 0 · 收藏 0 · 导出 2');
  await expect(cards.last()).toContainText('有效点赞 0 · 收藏 0 · 导出 1');
  await page.goBack();
  await expect(page).toHaveURL(/sort=recent-downloads/);
  await expect(cards.first()).toContainText('近7天有效导出 2');
  await page.goForward();
  await expect(page).toHaveURL(/sort=hot/);
  await capture(page, info, 'hot-light.png');
  await page.getByRole('button', { name: /^主题偏好：/ }).click();
  await page.getByRole('menuitemradio', { name: '深色', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await capture(page, info, 'hot-dark-large.png');
  if (info.project.name === 'desktop') {
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
    await page.getByRole('button', { name: /^主题偏好：/ }).click();
    await page.getByRole('menuitemradio', { name: '浅色', exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/light/);
    for (const [width, height] of [
      [360, 800],
      [430, 932],
      [768, 1024],
      [960, 900],
      [1024, 768],
      [1366, 768],
      [1920, 1080],
    ] as const) {
      await page.setViewportSize({ width, height });
      await capture(page, info, 'hot-light.png');
    }
  }
});

test('真实热度读取锁展示加载和失败，释放后原地重试并保留平台条件', async ({ page }, info) => {
  const database = rankingDatabase();
  const keeper = await database.pool.connect();
  await keeper.query('BEGIN');
  try {
    await keeper.query('LOCK TABLE export_subject_days IN ACCESS EXCLUSIVE MODE');
    await page.goto('/explore?sort=hot&platform=astrbot', { waitUntil: 'commit' });
    await expect(page.locator('#loading-content')).toBeVisible();
    await expect(page.getByText('暂时无法读取人设结果，请稍后重试', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/sort=hot/);
    await expect(page).toHaveURL(/platform=astrbot/);
    await capture(page, info, 'hot-unavailable.png');
  } finally {
    await keeper.query('ROLLBACK');
    keeper.release();
    await database.close();
  }
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  const results = page.getByRole('region', { name: '人设结果' });
  await expect(results.locator('a[href^="/personas/"]')).toHaveCount(1);
  await expect(results).toContainText(works.astrbot.title);
  await expect(results).toContainText('有效点赞 0 · 收藏 0 · 导出 1');
  await expect(
    page
      .getByRole('group', { name: '人设平台', exact: true })
      .getByRole('button', { name: 'AstrBot', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('平台与对话筛选保留热度，列表切换及下架后的零结果由真实API控制', async ({ page }, info) => {
  await page.goto('/explore?sort=hot');
  const results = page.getByRole('region', { name: '人设结果' });
  await page
    .getByRole('group', { name: '人设平台', exact: true })
    .getByRole('button', { name: 'AstrBot', exact: true })
    .click();
  await expect(page).toHaveURL(/sort=hot/);
  await expect(page).toHaveURL(/platform=astrbot/);
  await expect(page.locator('fieldset[aria-busy]')).toHaveAttribute('aria-busy', 'false');
  const mobile = page.getByRole('button', { name: '筛选人设', exact: true });
  const isMobile = await mobile.isVisible();
  await selectExploreFilter(page, '预设对话', '包含 AstrBot 对话');
  await expect(page).toHaveURL(/hasDialogue=true/);
  await expect(results.locator('a[href^="/personas/"]')).toHaveCount(1);
  await expect(results).toContainText(works.astrbot.title);
  await expect(results).toContainText('有效点赞 0 · 收藏 0 · 导出 1');
  if (isMobile) {
    const filterBounds = await mobile.boundingBox();
    const sortBounds = await page
      .getByRole('combobox', { name: '结果排序', exact: true })
      .boundingBox();
    const viewBounds = await page
      .getByRole('button', { name: '列表视图', exact: true })
      .boundingBox();
    if (!filterBounds || !sortBounds || !viewBounds) throw new Error('缺少手机筛选操作栏');
    expect(Math.abs(filterBounds.y - sortBounds.y)).toBeLessThan(1);
    expect(Math.abs(filterBounds.y - viewBounds.y)).toBeLessThan(1);
  }
  await page.getByRole('button', { name: '列表视图', exact: true }).click();
  await expect(page).toHaveURL(/view=list/);
  await page.reload();
  await expect(results).toContainText('有效点赞 0 · 收藏 0 · 导出 1');
  await capture(page, info, 'hot-filtered-list.png');
  try {
    expect(
      (
        await browserWrite(author, '/api/v1/me/personas/' + works.astrbot.id + '/visibility', {
          visibility: 'hidden',
          reason: '核验热度结果即时下架',
        })
      ).status(),
    ).toBe(200);
    await page.reload();
    await expect(page.getByText('没有找到匹配的人设', { exact: true })).toBeVisible();
    await expect(results).not.toContainText(works.astrbot.title);
    expect((await page.request.get('/api/v1/personas/' + works.astrbot.id)).status()).toBe(404);
  } finally {
    expect(
      (
        await browserWrite(author, '/api/v1/me/personas/' + works.astrbot.id + '/visibility', {
          visibility: 'listed',
          reason: '完成隔离热度边界验收',
        })
      ).status(),
    ).toBe(200);
  }
});
