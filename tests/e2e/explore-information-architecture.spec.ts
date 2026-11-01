import { openExploreFilters as openAdvanced } from '../fixtures/explore-filters.js';
import {
  expect,
  test as base,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { TaxonomyResponseSchema } from '@personamarket/contracts';
import { loginCreator } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { visualPersonas } from '../fixtures/visual-personas.js';

const test = base.extend({
  hasTouch: async ({ browserName }, use, info) => {
    if (browserName !== 'chromium') throw new Error('当前探索验收使用Chromium');
    await use(info.project.name === 'mobile');
  },
});
test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });

let cached:
  | {
      works: Awaited<ReturnType<typeof visualPersonas>>;
      taxonomy: ReturnType<typeof TaxonomyResponseSchema.parse>['data'];
      cookies: Awaited<ReturnType<BrowserContext['cookies']>>;
    }
  | undefined;

async function samples(page: Page, browser: Browser) {
  // 本文件只读检查筛选，复用一次真实发布/审核的作品，避免重复上传消耗生产限流。
  if (cached) {
    await page.context().addCookies(cached.cookies);
    const [firstTag, secondTag] = cached.taxonomy.tags;
    if (!firstTag || !secondTag) throw new Error('需要真实标签配置');
    return {
      works: cached.works,
      firstTag,
      secondTag,
      tags: cached.taxonomy.tags,
      context: page.context(),
    };
  }
  await loginCreator(page);
  const context = await browser.newContext({
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
  });
  try {
    const admin = await context.newPage();
    await loginBrowserAdmin(admin);
    const works = await visualPersonas(page, admin);
    const taxonomy = TaxonomyResponseSchema.parse(
      await (await page.request.get('/api/v1/site/taxonomy')).json(),
    ).data;
    const [firstTag, secondTag] = taxonomy.tags;
    if (!firstTag || !secondTag) throw new Error('需要真实标签配置');
    cached = { works, taxonomy, cookies: await page.context().cookies() };
    return { works, firstTag, secondTag, tags: taxonomy.tags, context: page.context() };
  } finally {
    await context.close();
  }
}

test('高级条件默认收起，取消不应用；确认后可删除单项并保留其它URL条件', async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const data = await samples(page, browser);
  try {
    await page.goto('/explore?q=' + encodeURIComponent('春日书房'));
    await expect(page.getByRole('heading', { name: '探索人设', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: '分类选项', exact: true })).toBeHidden();
    await expect(page.getByRole('group', { name: '标签 / 风格选项', exact: true })).toBeHidden();
    const original = page.url();
    let { sheet, trigger } = await openAdvanced(page);
    const selectTags = async () => {
      const choices = sheet.getByRole('group', { name: '标签 / 风格选项', exact: true });
      await choices.getByRole('button', { name: data.firstTag.name, exact: true }).click();
      await choices.getByRole('button', { name: data.secondTag.name, exact: true }).click();
    };
    await selectTags();
    expect(page.url()).toBe(original);
    await sheet.getByRole('button', { name: '取消', exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(page.url()).toBe(original);

    ({ sheet, trigger } = await openAdvanced(page));
    await expect(
      sheet.getByRole('button', { name: data.firstTag.name, exact: true }),
    ).toHaveAttribute('aria-pressed', 'false');
    await selectTags();
    await sheet.getByRole('button', { name: '查看结果', exact: true }).click();
    await expect(page).toHaveURL(/tagIds=/);
    const selected = new URL(page.url()).searchParams.get('tagIds')?.split(',');
    expect(selected).toHaveLength(2);
    expect(selected).toEqual(expect.arrayContaining([data.firstTag.id, data.secondTag.id]));
    await expect(page.getByRole('group', { name: '标签 / 风格选项', exact: true })).toBeHidden();

    await page
      .getByRole('group', { name: '人设平台', exact: true })
      .getByRole('button', { name: 'MaiBot', exact: true })
      .click();
    await expect(page).toHaveURL(/platform=maibot/);
    await page.getByRole('combobox', { name: '结果排序', exact: true }).click();
    await page.getByRole('option', { name: '最近更新', exact: true }).click();
    await expect(page).toHaveURL(/sort=updated/);
    await page.getByRole('button', { name: '列表视图', exact: true }).click();
    await expect(page).toHaveURL(/view=list/);
    const chips = page.getByRole('group', { name: '已选筛选', exact: true });
    const remove = chips.getByRole('button', {
      name: '移除标签：' + data.firstTag.name,
      exact: true,
    });
    const bounds = await remove.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    await remove.click();
    await expect(remove).toHaveCount(0);
    const params = new URL(page.url()).searchParams;
    expect(params.get('tagIds')).toBe(data.secondTag.id);
    expect(params.get('platform')).toBe('maibot');
    expect(params.get('q')).toBe('春日书房');
    expect(params.get('sort')).toBe('updated');
    expect(params.get('view')).toBe('list');
    const results = page.getByRole('region', { name: '人设结果', exact: true });
    await expect(
      results
        .locator('a[href="/personas/' + data.works.maibot.id + '"]')
        .filter({ hasText: data.works.maibot.title }),
    ).toBeVisible();
    await expect(
      results
        .locator('a[href="/personas/' + data.works.astrbot.id + '"]')
        .filter({ hasText: data.works.astrbot.title }),
    ).toHaveCount(0);
    const shared = page.url();
    await page.reload();
    expect(page.url()).toBe(shared);
    await expect(
      chips.getByRole('button', { name: '移除标签：' + data.secondTag.name, exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
  } finally {
    await data.context.close();
  }
});

test('标签上限错误留在暂存面板，Escape取消且浏览器返回恢复真实结果', async ({ page, browser }) => {
  test.setTimeout(90000);
  const data = await samples(page, browser);
  try {
    const params = new URLSearchParams({
      q: '春日书房',
      platform: 'astrbot',
      tagId: data.firstTag.id,
      sort: 'updated',
      view: 'list',
    });
    await page.goto('/explore?' + params.toString());
    await expect(page.getByRole('heading', { name: '探索人设', exact: true })).toBeVisible();
    const original = page.url();
    const { sheet, trigger } = await openAdvanced(page);
    await sheet.getByRole('button', { name: '重置筛选', exact: true }).click();
    await sheet.getByRole('button', { name: '更多', exact: true }).click();
    if (data.tags.length < 9) throw new Error('需要至少九个真实标签验证上限');
    const choices = sheet.getByRole('group', { name: '标签 / 风格选项', exact: true });
    for (const tag of data.tags.slice(0, 9))
      await choices.getByRole('button', { name: tag.name, exact: true }).click();
    await expect(sheet.getByRole('alert')).toHaveText('最多同时选择8个标签');
    const ninth = data.tags[8];
    if (!ninth) throw new Error('缺少第九个标签');
    await expect(choices.getByRole('button', { name: ninth.name, exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(page.url()).toBe(original);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(page.getByText('最多同时选择8个标签', { exact: true })).toHaveCount(0);
    expect(page.url()).toBe(original);
    await page
      .getByRole('group', { name: '人设平台', exact: true })
      .getByRole('button', { name: 'MaiBot', exact: true })
      .click();
    await expect(page).toHaveURL(/platform=maibot/);
    const results = page.getByRole('region', { name: '人设结果', exact: true });
    await expect(
      results
        .locator('a[href="/personas/' + data.works.maibot.id + '"]')
        .filter({ hasText: data.works.maibot.title }),
    ).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/platform=astrbot/);
    await expect(
      results
        .locator('a[href="/personas/' + data.works.astrbot.id + '"]')
        .filter({ hasText: data.works.astrbot.title }),
    ).toBeVisible();
    expect(new URL(page.url()).searchParams.get('tagId')).toBe(data.firstTag.id);
    await expect(
      page.getByRole('button', { name: '移除标签：' + data.firstTag.name, exact: true }),
    ).toBeVisible();
  } finally {
    await data.context.close();
  }
});

test('无结果和非法URL的清空入口满足触控尺寸并支持键盘恢复', async ({ page }) => {
  for (const [route, message] of [
    ['/explore?q=absent-isolated-fixture', '没有找到匹配的人设'],
    ['/explore?platform=invalid', '筛选条件格式不正确，请清空后重试'],
  ] as const) {
    await page.goto(route);
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    const clear = page.getByRole('link', { name: '清空条件', exact: true });
    const bounds = await clear.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    await clear.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/explore$/);
    await expect(page.getByRole('heading', { name: '探索人设', exact: true })).toBeVisible();
  }
});

test('真实有总量的越页不冒充无作品，排序视图保留；正常首次触控筛选取消恢复焦点与滚动', async ({
  page,
  browser,
}, info) => {
  const data = await samples(page, browser);
  try {
    await page.goto('/explore?platform=maibot&page=500&sort=updated&view=list');
    const results = page.getByRole('region', { name: '人设结果', exact: true });
    await expect(results.getByText('这一页没有作品', { exact: true })).toBeVisible();
    await expect(results.getByText('暂无公开作品', { exact: true })).toHaveCount(0);
    const first = results.getByRole('link', { name: '返回第一页', exact: true });
    await expect(first).toHaveAttribute('href', '/explore?platform=maibot&sort=updated&view=list');
    await first.click();
    await expect(
      results
        .locator('a[href="/personas/' + data.works.maibot.id + '"]')
        .filter({ hasText: data.works.maibot.title }),
    ).toBeVisible();
    const trigger =
      (page.viewportSize()?.width ?? 1440) >= 1024
        ? page.getByRole('button', { name: /^高级筛选/ })
        : page.getByRole('button', { name: '筛选人设', exact: true });
    await expect(trigger).toBeEnabled();
    const before = await page.evaluate(() => ({ scrollY, url: location.href }));
    if (info.project.name === 'mobile') await trigger.tap();
    else await trigger.click();
    const sheet = page.getByRole('dialog', { name: '筛选人设', exact: true });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: '取消', exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(page.url()).toBe(before.url);
    expect(Math.abs((await page.evaluate(() => scrollY)) - before.scrollY)).toBeLessThanOrEqual(2);
  } finally {
    await data.context.close();
  }
});

test('重置只修改暂存高级条件，取消恢复原筛选，确认仍保留搜索平台排序与视图', async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const data = await samples(page, browser);
  try {
    const query = new URLSearchParams({
      q: '春日书房',
      platform: 'astrbot',
      tagIds: data.firstTag.id,
      origin: 'original',
      sort: 'updated',
      view: 'list',
    });
    await page.goto('/explore?' + query.toString());
    await expect(page.getByRole('heading', { name: '探索人设', exact: true })).toBeVisible();
    const original = page.url();
    let { sheet, trigger } = await openAdvanced(page);
    await sheet.getByRole('button', { name: '重置筛选', exact: true }).click();
    await expect(
      sheet.getByRole('button', { name: data.firstTag.name, exact: true }),
    ).toHaveAttribute('aria-pressed', 'false');
    expect(page.url()).toBe(original);
    await sheet.getByRole('button', { name: '取消', exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(page.url()).toBe(original);
    await expect(
      page.getByRole('button', { name: '移除标签：' + data.firstTag.name, exact: true }),
    ).toBeVisible();

    ({ sheet, trigger } = await openAdvanced(page));
    await sheet.getByRole('button', { name: '重置筛选', exact: true }).click();
    await sheet.getByRole('button', { name: '查看结果', exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect.poll(() => new URL(page.url()).searchParams.get('tagIds')).toBe(null);
    const params = new URL(page.url()).searchParams;
    expect(params.get('tagId')).toBe(null);
    expect(params.get('origin')).toBe(null);
    expect(params.get('q')).toBe('春日书房');
    expect(params.get('platform')).toBe('astrbot');
    expect(params.get('sort')).toBe('updated');
    expect(params.get('view')).toBe('list');
    const results = page.getByRole('region', { name: '人设结果', exact: true });
    await expect(
      results
        .locator('a[href="/personas/' + data.works.astrbot.id + '"]')
        .filter({ hasText: data.works.astrbot.title }),
    ).toBeVisible();
    await expect(
      results
        .locator('a[href="/personas/' + data.works.maibot.id + '"]')
        .filter({ hasText: data.works.maibot.title }),
    ).toHaveCount(0);
  } finally {
    await data.context.close();
  }
});
