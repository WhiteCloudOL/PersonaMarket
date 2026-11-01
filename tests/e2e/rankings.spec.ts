import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loginCreator, browserWrite } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { visualPersonas } from '../fixtures/visual-personas.js';
import { seedSearchLoad } from '../fixtures/search-load.js';
import { rankingDatabase, refreshRanking } from '../fixtures/rankings.js';

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
    summary: '在长长的书页间记录中文故事，认真倾听每一次相遇与创作的灵感'.repeat(4),
  });
});
test.afterAll(async () => {
  await reviewerContext?.close();
  await authorContext?.close();
});
test.beforeEach(async ({ page }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
});

async function capture(page: Page, info: TestInfo, name: string) {
  await expect(page.getByRole('button', { name: '刷新榜单', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const image of await page.locator('ol[aria-label="人设排名"] img').all()) {
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
  const overflows = await page
    .locator(
      'ol[aria-label="人设排名"] [data-slot="card-title"], ol[aria-label="人设排名"] [data-slot="card-description"]',
    )
    .evaluateAll((elements) =>
      elements.flatMap((element) => {
        if (!(element instanceof HTMLElement)) return [];
        const card = element.closest('[data-slot="card"]');
        if (!card) return [];
        const bounds = element.getBoundingClientRect();
        return bounds.right > card.getBoundingClientRect().right + 1 ||
          element.scrollWidth > element.clientWidth + 1
          ? [
              {
                text: element.textContent?.slice(0, 48),
                width: element.clientWidth,
                scrollWidth: element.scrollWidth,
              },
            ]
          : [];
      }),
    );
  expect(overflows).toEqual([]);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('缺少真实浏览器视口');
  const directory = join('data/tests/rankings/current', `${viewport.width}x${viewport.height}`);
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: join(directory, name), fullPage: true });
  await info.attach(name, { path: join(directory, name), contentType: 'image/png' });
}

test('导航进入真实准备状态，重试得到空热门榜，键盘切到新作且适用范围清晰', async ({
  page,
}, info) => {
  await page.goto('/');
  const navigation = page.getByRole('navigation', { name: '主导航', exact: true });
  if (await navigation.isVisible())
    await navigation.getByRole('link', { name: '排行', exact: true }).click();
  else {
    await page.getByRole('button', { name: '打开导航', exact: true }).click();
    await page
      .getByRole('navigation', { name: '移动端主导航', exact: true })
      .getByRole('link', { name: '排行', exact: true })
      .click();
  }
  await expect(page.getByRole('heading', { name: '人设排行榜', exact: true })).toBeVisible();
  await expect(page.getByText('暂时无法读取榜单', { exact: true })).toBeVisible();
  await refreshRanking(page);
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByText('还没有符合条件的人设', { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('group', { name: '统计范围选项', exact: true })
      .getByRole('button', { name: '全部时间', exact: true }),
  ).toBeDisabled();
  await capture(page, info, 'empty-light.png');
  const newest = page
    .getByRole('group', { name: '榜单类型选项', exact: true })
    .getByRole('button', { name: '新作', exact: true });
  await newest.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/kind=new/);
  await expect(
    page.getByRole('list', { name: '人设排名', exact: true }).getByRole('listitem'),
  ).toHaveCount(2);
  await expect(newest).toBeFocused();
  await expect(
    page
      .getByRole('group', { name: '统计范围选项', exact: true })
      .getByRole('button', { name: '运营窗口', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('真实有效导出榜、平台URL前进后退、旧批次即时隐藏、深色大字与长标题', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(60000);
  const extra = await browser.newContext({
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
  });
  try {
    for (const work of [works.maibot, works.astrbot]) {
      const download = await page.request.get(
        '/api/v1/personas/' + work.id + '/releases/' + work.releaseId + '/export?format=text',
      );
      expect(download.status()).toBe(200);
      await download.body();
    }
    const additional = await extra.request.get(
      '/api/v1/personas/' +
        works.maibot.id +
        '/releases/' +
        works.maibot.releaseId +
        '/export?format=markdown',
    );
    expect(additional.status()).toBe(200);
    await additional.body();
  } finally {
    await extra.close();
  }
  const id = await refreshRanking(page);
  await page.goto('/rankings?kind=downloads&window=all');
  const list = page.getByRole('list', { name: '人设排名', exact: true });
  await expect(list.getByRole('listitem').first()).toContainText(works.maibot.title);
  await expect(list.getByRole('listitem').first()).toContainText('有效导出 2');
  await capture(page, info, 'downloads-light.png');
  const astrbot = page
    .getByRole('group', { name: '人设平台选项', exact: true })
    .getByRole('button', { name: 'AstrBot', exact: true });
  await astrbot.click();
  await expect(page).toHaveURL(/platform=astrbot/);
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText(works.astrbot.title);
  await page
    .getByRole('group', { name: '统计范围选项', exact: true })
    .getByRole('button', { name: '近 7 天', exact: true })
    .click();
  await expect(page).not.toHaveURL(/window=all/);
  await page.goBack();
  await expect(page).toHaveURL(/window=all/);
  await expect(astrbot).toHaveAttribute('aria-pressed', 'true');
  await page.goForward();
  await expect(page).not.toHaveURL(/window=all/);
  await page.goto('/rankings?kind=downloads&window=all&snapshotId=' + id);
  try {
    expect(
      (
        await browserWrite(author, '/api/v1/me/personas/' + works.maibot.id + '/visibility', {
          visibility: 'hidden',
          reason: '核验真实旧榜单即时过滤',
        })
      ).status(),
    ).toBe(200);
    await page.reload();
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list).not.toContainText(works.maibot.title);
  } finally {
    expect(
      (
        await browserWrite(author, '/api/v1/me/personas/' + works.maibot.id + '/visibility', {
          visibility: 'listed',
          reason: '完成榜单公开边界回归',
        })
      ).status(),
    ).toBe(200);
  }
  await page.getByRole('button', { name: '刷新榜单', exact: true }).click();
  await expect(page).not.toHaveURL(/snapshotId=/);
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await page.getByRole('button', { name: /^主题偏好：/ }).click();
  await page.getByRole('menuitemradio', { name: '深色', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await capture(page, info, 'downloads-dark-large.png');
});

test('真实读取锁展示加载与失败，释放后保留条件重试，过期和非法地址可恢复', async ({ page }) => {
  const database = rankingDatabase();
  const keeper = await database.pool.connect();
  await keeper.query('BEGIN');
  try {
    await keeper.query('LOCK TABLE ranking_entries IN ACCESS EXCLUSIVE MODE');
    await page.goto('/rankings?kind=downloads&window=30d&platform=astrbot', {
      waitUntil: 'commit',
    });
    await expect(page.getByText('正在读取榜单…', { exact: true })).toBeVisible();
    await expect(page.getByText('暂时无法读取榜单', { exact: true })).toBeVisible();
  } finally {
    await keeper.query('ROLLBACK');
    keeper.release();
    await database.close();
  }
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(
    page.getByRole('list', { name: '人设排名', exact: true }).getByRole('listitem'),
  ).toHaveCount(1);
  await expect(page).toHaveURL(/window=30d.*platform=astrbot/);
  await page.goto('/rankings?kind=downloads&window=all&snapshotId=' + randomUUID());
  await expect(page.getByText('这批榜单已过期', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '载入最新榜单', exact: true }).click();
  await expect(page).not.toHaveURL(/snapshotId=/);
  await expect(
    page.getByRole('list', { name: '人设排名', exact: true }).getByRole('listitem'),
  ).toHaveCount(2);
  await page.goto('/rankings?kind=hot&window=all');
  await expect(page.getByText('筛选地址格式不正确', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '清空条件', exact: true }).click();
  await expect(
    page.getByRole('list', { name: '人设排名', exact: true }).getByRole('listitem'),
  ).toHaveCount(2);
});

test('真实API读取受约束容量夹具，下一页与浏览器返回保留相同快照', async ({ page }) => {
  const database = rankingDatabase();
  const client = await database.pool.connect();
  try {
    await seedSearchLoad(client, works.maibot.id, 21);
  } finally {
    client.release();
    await database.close();
  }
  await refreshRanking(page);
  await page.goto('/rankings?kind=new');
  const list = page.getByRole('list', { name: '人设排名', exact: true });
  await expect(list.getByRole('listitem')).toHaveCount(20);
  const next = page
    .getByRole('navigation', { name: '排行榜分页', exact: true })
    .getByRole('link', { name: '下一页', exact: true });
  const href = await next.getAttribute('href');
  expect(href).toContain('snapshotId=');
  await next.click();
  await expect(page).toHaveURL(/page=2/);
  const id = new URL(page.url()).searchParams.get('snapshotId');
  expect(id).toBeTruthy();
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await page.reload();
  expect(new URL(page.url()).searchParams.get('snapshotId')).toBe(id);
  await page.getByRole('link', { name: '上一页', exact: true }).click();
  await expect(list.getByRole('listitem')).toHaveCount(20);
  expect(new URL(page.url()).searchParams.get('snapshotId')).toBe(id);
  await page.goBack();
  await expect(page).toHaveURL(/page=2/);
  await expect(list.getByRole('listitem')).toHaveCount(3);
});

test('统计说明按需展开，触控键盘与跨断点保留榜单条件和快照', async ({ browser }, info) => {
  const mobile = info.project.name === 'mobile';
  const viewport = mobile
    ? { width: 390, height: 844 }
    : info.project.name === 'tablet'
      ? { width: 768, height: 1024 }
      : { width: 1440, height: 900 };
  const context = await browser.newContext({
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    viewport,
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: 'reduce',
  });
  try {
    const page = await context.newPage();
    const id = await refreshRanking(page);
    await page.goto('/rankings?kind=new&platform=astrbot&snapshotId=' + id);
    const list = page.getByRole('list', { name: '人设排名', exact: true });
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list).toContainText(works.astrbot.title);
    const originalUrl = page.url();
    await expect(page.getByRole('heading', { name: '这份榜单如何计算', exact: true })).toHaveCount(
      0,
    );
    const trigger = page.getByRole('button', { name: '统计说明', exact: true });
    const target = await trigger.boundingBox();
    expect(target?.height).toBeGreaterThanOrEqual(44);
    expect(target?.width).toBeGreaterThanOrEqual(44);
    if (mobile) await trigger.tap();
    else {
      await trigger.focus();
      await page.keyboard.press('Enter');
    }
    const sheet = page.getByRole('dialog', { name: '这份榜单如何计算', exact: true });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('有效点赞×3、收藏×4、导出×1');
    await expect(sheet).toContainText('取消重加保留首次时间');
    await expect(sheet).toContainText('收藏者身份始终私有');
    await expect(sheet).toContainText('近 7 天的有效导出按时间衰减');
    await expect(sheet).toContainText('7 天半衰期');
    await expect(sheet).toContainText(
      '同一主体、同一人设在一个 UTC 日期内跨格式、跨版本最多计一次',
    );
    await expect(sheet).toContainText('作者本人不计入排名，匿名去重为近似统计');
    await expect(sheet).toContainText('新作看首次公开时间，补丁保留首次时间');
    await expect(sheet).toContainText('更新榜看当前公开版本');
    await expect(sheet).toContainText('本批约每 5 分钟安排刷新');
    await expect(sheet).toContainText('隐藏和下架状态会在读取时即时过滤');
    await expect(sheet).toContainText('每个榜单最多展示 1000 项');
    expect(page.url()).toBe(originalUrl);
    await page.keyboard.press('Tab');
    expect(await sheet.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.setViewportSize({ width: mobile ? 1440 : 390, height: 844 });
    await expect(sheet).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    const disclaimer = sheet.getByText(
      '有效导出仅表示服务端提供了文件响应，保存或安装需在目标平台确认',
      { exact: true },
    );
    await disclaimer.scrollIntoViewIfNeeded();
    await expect(disclaimer).toBeInViewport();
    const close = sheet.getByRole('button', { name: '返回榜单', exact: true });
    await expect(close).toBeInViewport();
    expect(await sheet.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
      false,
    );
    if (mobile) await close.tap();
    else await close.click();
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
    await page.setViewportSize(viewport);
    expect(page.url()).toBe(originalUrl);
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(
      page.getByRole('group', { name: '人设平台选项', exact: true }).getByRole('button', {
        name: 'AstrBot',
        exact: true,
      }),
    ).toHaveAttribute('aria-pressed', 'true');
    await trigger.click();
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    const main = await page.locator('#main').boundingBox();
    const results = await page.getByRole('region', { name: '榜单结果', exact: true }).boundingBox();
    if (!main || !results) throw new Error('榜单布局未就绪');
    expect(results.width).toBeGreaterThan(main.width * 0.9);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
  } finally {
    await context.close();
  }
});
