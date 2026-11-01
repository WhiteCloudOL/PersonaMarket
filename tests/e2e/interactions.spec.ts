import { selectTheme } from '../fixtures/theme.js';
import { selectAccountNavigation } from '../fixtures/account-navigation.js';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import {
  InteractionSettingsResponseSchema,
  PublicReleaseResponseSchema,
} from '@personamarket/contracts';
import { loginCreator, browserWrite } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { visualPersonas } from '../fixtures/visual-personas.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });
let authorContext: BrowserContext;
let adminContext: BrowserContext;
let author: Page;
let admin: Page;
let works: Awaited<ReturnType<typeof visualPersonas>>;
test.beforeAll(async ({ browser }, info) => {
  const viewport =
    info.project.name === 'desktop' ? { width: 1440, height: 900 } : info.project.use.viewport;
  const options = {
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    ...(viewport ? { viewport } : {}),
    hasTouch: info.project.use.hasTouch ?? false,
    isMobile: info.project.use.isMobile ?? false,
    deviceScaleFactor: info.project.use.deviceScaleFactor ?? 1,
  };
  authorContext = await browser.newContext(options);
  adminContext = await browser.newContext(options);
  author = await authorContext.newPage();
  admin = await adminContext.newPage();
  await loginCreator(author);
  await loginBrowserAdmin(admin);
  const suffix = randomUUID().slice(0, 8);
  works = await visualPersonas(author, admin, {
    titles: {
      maibot: '星旅互动作品 · ' + 'CreativeStories'.repeat(3) + suffix,
      astrbot: '星光收藏来信 · ' + '午后书房和星光旅途的故事'.repeat(3) + suffix,
    },
  });
});
test.afterAll(async () => {
  try {
    if (works)
      for (const work of [works.maibot, works.astrbot])
        expect(
          (
            await browserWrite(author, '/api/v1/me/personas/' + work.id + '/visibility', {
              visibility: 'hidden',
              reason: '结束隔离互动验收',
            })
          ).status(),
        ).toBe(200);
  } finally {
    await Promise.all([authorContext?.close(), adminContext?.close()]);
  }
});
test.beforeEach(async ({ page }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
});
async function capture(page: Page, info: TestInfo, name: string) {
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
  const size = page.viewportSize();
  if (!size) throw new Error('缺少浏览器视口');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const control of await page
    .locator('[aria-label="作品互动"] button, [aria-label="作品互动"] a')
    .all()) {
    if (!(await control.isVisible())) continue;
    const bounds = await control.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
  }
  const brokenLabels = await page
    .locator('[aria-label="作品互动"] button, [aria-label="作品互动"] a')
    .evaluateAll((buttons) =>
      buttons.flatMap((button) => {
        const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
        const broken: string[] = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const label = node.textContent?.trim();
          if (label !== '点赞' && label !== '收藏') continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const rectangles = [...range.getClientRects()].filter(
            (rect) => rect.width > 0 && rect.height > 0,
          );
          if (rectangles.length > 1) broken.push(label);
        }
        return broken;
      }),
    );
  expect(brokenLabels, '点赞与收藏的操作词应完整显示，不能逐字竖排').toEqual([]);
  expect(await page.locator('#main a button, #main a a').count()).toBe(0);
  const directory = join('data/tests/interactions/current', `${size.width}x${size.height}`);
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => scrollTo(0, 0));
  const path = join(directory, name + '.png');
  await page.screenshot({ path, fullPage: true });
  await page.screenshot({ path: join(directory, name + '-viewport.png') });
  await info.attach(name, { path, contentType: 'image/png' });
}
async function favorite(page: Page, id: string) {
  await page.goto('/personas/' + id);
  const controls = page.getByLabel('作品互动', { exact: true });
  const response = page.waitForResponse(
    (item) =>
      item.url().endsWith('/api/v1/personas/' + id + '/favorite') &&
      item.request().method() === 'PUT',
  );
  await controls.getByRole('button', { name: '收藏', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(controls.getByRole('button', { name: '取消收藏', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
}

test('初次公开页面水合不替换卡片且键盘筛选可用', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(/Minified React error #\d+/.exec(error.message)?.[0] ?? 'BROWSER_ERROR');
  });
  const context = page.waitForResponse(
    (response) => response.url().endsWith('/api/v1/auth/context') && response.status() === 200,
  );
  await page.goto('/explore', { waitUntil: 'commit' });
  const cards = page.getByRole('region', { name: '人设结果' }).locator('article');
  await expect(cards).toHaveCount(2);
  const serverCard = await cards.first().elementHandle();
  if (!serverCard) throw new Error('缺少服务端公开卡片');
  try {
    const size = page.viewportSize();
    if (!size) throw new Error('缺少浏览器视口');
    const directory = join('data/tests/interactions/current', `${size.width}x${size.height}`);
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: join(directory, 'hydration-server.png'), fullPage: true });
    await context;
    await expect(
      page.getByRole('banner').getByRole('link', { name: '登录', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: '登录后点赞', exact: true })).toHaveCount(2);
    const nodePreserved = await serverCard.evaluate((element) => element.isConnected);
    await writeFile(
      join(directory, 'hydration-result.json'),
      JSON.stringify({ nodePreserved, errors }, null, 2),
    );
    await page.screenshot({ path: join(directory, 'hydration-client.png'), fullPage: true });
    expect(errors, '真实首屏不应触发React水合恢复').toEqual([]);
    expect(nodePreserved, '互动初始化不能替换已显示的服务端卡片').toBe(true);
    const sort = page.getByRole('combobox', { name: '结果排序', exact: true });
    await expect(sort).toBeEnabled();
    await sort.focus();
    await expect(sort).toBeFocused();
    await page.keyboard.press('Enter');
    await page.getByRole('option', { name: '有效导出', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/sort=downloads/);
    await expect(sort).toBeFocused();
  } finally {
    await serverCard.dispose();
  }
});
test('卡片与详情真实点赞收藏、键盘操作、传输失败重试和私有收藏URL筛选分页', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  await page.goto('/personas/' + works.maibot.id);
  await expect(page.getByRole('link', { name: '登录后点赞', exact: true })).toHaveAttribute(
    'href',
    '/login',
  );
  await loginCreator(page);
  await page.goto('/explore?q=' + encodeURIComponent(works.maibot.title));
  const card = page
    .locator('article')
    .filter({ has: page.getByText(works.maibot.title, { exact: true }) });
  await expect(card).toHaveCount(1);
  const before = PublicReleaseResponseSchema.parse(
    await (await page.request.get('/api/v1/personas/' + works.maibot.id)).json(),
  ).data.interactionCounts;
  const like = card.getByRole('button', { name: '点赞', exact: true });
  await expect(like).toBeEnabled();
  await like.focus();
  await expect(like).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(card.getByRole('button', { name: '取消点赞', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const after = PublicReleaseResponseSchema.parse(
    await (await page.request.get('/api/v1/personas/' + works.maibot.id)).json(),
  ).data.interactionCounts;
  expect(after.likes).toBe(before.likes + 1);
  await expect(
    card.getByRole('button', { name: '取消点赞', exact: true }),
  ).toHaveAccessibleDescription('当前点赞总数 ' + after.likes);
  const pattern = '**/api/v1/personas/' + works.maibot.id + '/like';
  await page.route(pattern, (route) => route.abort('failed'));
  await card.getByRole('button', { name: '取消点赞', exact: true }).click();
  await expect(card.getByText('请再试一次', { exact: true })).toBeVisible();
  await expect(card.getByText('互动暂时无法完成，请稍后重试', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: '取消点赞', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.unroute(pattern);
  await card.getByRole('button', { name: '取消点赞', exact: true }).click();
  await expect(card.getByRole('button', { name: '点赞', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await card.getByRole('button', { name: '收藏', exact: true }).click();
  await expect(card.getByRole('button', { name: '取消收藏', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await capture(page, info, 'explore-interactions');
  await favorite(page, works.astrbot.id);
  await capture(page, info, 'detail-interactions');
  await selectAccountNavigation(page, '我的收藏');
  await expect(page).toHaveURL(/\/dashboard\/favorites$/);
  await expect(page.getByRole('heading', { name: '我的收藏', exact: true })).toBeVisible();
  await expect(page.getByText('共 2 项收藏，仅你自己可见', { exact: true })).toBeVisible();
  await page.goto('/dashboard/favorites?pageSize=1&sort=oldest');
  await expect(page.locator('article')).toHaveCount(1);
  await expect(page.getByText(works.maibot.title, { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '下一页收藏', exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByText(works.astrbot.title, { exact: true })).toBeVisible();
  await page.goto('/dashboard/favorites');
  await page.getByRole('combobox', { name: '人设平台', exact: true }).click();
  await page.getByRole('option', { name: 'AstrBot', exact: true }).click();
  await page.getByRole('button', { name: '筛选收藏', exact: true }).click();
  await expect(page).toHaveURL(/platform=astrbot/);
  await expect(page.locator('article')).toHaveCount(1);
  await expect(page.getByText(works.maibot.title, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '清除条件', exact: true }).click();
  await expect(page.locator('article')).toHaveCount(2);
  await capture(page, info, 'favorites-light');
  await selectTheme(page, 'dark');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await capture(page, info, 'favorites-dark-large');
  if (info.project.name === 'desktop') {
    await selectTheme(page, 'light');
    await page.evaluate(() => document.documentElement.style.removeProperty('font-size'));
    await admin.goto('/admin/settings/community');
    try {
      for (const viewport of [
        { width: 360, height: 800 },
        { width: 430, height: 932 },
        { width: 960, height: 800 },
        { width: 1024, height: 768 },
        { width: 1366, height: 768 },
        { width: 1920, height: 1080 },
      ]) {
        await page.setViewportSize(viewport);
        await capture(page, info, 'favorites-layout-light');
        await admin.setViewportSize(viewport);
        await capture(admin, info, 'community-layout-light');
        if (viewport.width === 430) {
          await page.evaluate(() => {
            document.documentElement.style.fontSize = '200%';
          });
          await capture(page, info, 'favorites-layout-large');
          await page.evaluate(() => document.documentElement.style.removeProperty('font-size'));
        }
      }
    } finally {
      await admin.setViewportSize({ width: 1440, height: 900 });
    }
  }
});

test('隐藏作品收藏只显示占位、本人可以移除，真实换号后不保留前一个账号的私有收藏', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  await loginCreator(page);
  await favorite(page, works.maibot.id);
  await favorite(page, works.astrbot.id);
  expect(
    (
      await browserWrite(author, '/api/v1/me/personas/' + works.maibot.id + '/visibility', {
        visibility: 'hidden',
        reason: '验证不可用收藏占位',
      })
    ).status(),
  ).toBe(200);
  let other: Page | undefined;
  try {
    await page.goto('/dashboard/favorites');
    await expect(page.getByText('作品暂不可用', { exact: true })).toBeVisible();
    await expect(page.getByText(works.maibot.title, { exact: true })).toHaveCount(0);
    const response = await page.request.get('/api/v1/me/favorites?availability=unavailable');
    const payload: unknown = await response.json();
    expect(JSON.stringify(payload)).not.toContain(works.maibot.title);
    expect(JSON.stringify(payload)).not.toContain('snapshot');
    await capture(page, info, 'favorites-unavailable');
    await page.getByRole('button', { name: '移除不可用收藏', exact: true }).click();
    await expect(page.getByText('作品暂不可用', { exact: true })).toHaveCount(0);
    // 同一浏览器会话里的另一个标签页走真实登录与跨页会话通知
    other = await page.context().newPage();
    await loginCreator(other);
    await page.bringToFront();
    await expect(page.getByText('共 0 项收藏，仅你自己可见', { exact: true })).toBeVisible();
    await expect(page.getByText(works.astrbot.title, { exact: true })).toHaveCount(0);
    await capture(page, info, 'favorites-switched-account');
  } finally {
    await other?.close();
    expect(
      (
        await browserWrite(author, '/api/v1/me/personas/' + works.maibot.id + '/visibility', {
          visibility: 'listed',
          reason: '恢复隔离作品继续回归',
        })
      ).status(),
    ).toBe(200);
  }
});

test('社区开关冲突保留输入并由用户重试，关闭直接API拒绝且旧收藏可取消', async ({ page }, info) => {
  test.setTimeout(60000);
  await loginCreator(page);
  await favorite(page, works.maibot.id);
  await admin.goto('/admin/settings/community');
  const likes = admin.getByRole('switch', { name: '开放新增点赞', exact: true });
  const favorites = admin.getByRole('switch', { name: '开放新增收藏', exact: true });
  await expect(likes).toBeChecked();
  try {
    await likes.click();
    await favorites.click();
    if (info.project.name === 'desktop') {
      admin.once('dialog', (dialog) => dialog.dismiss());
      await admin.getByRole('link', { name: '站点品牌', exact: true }).click();
      await expect(admin).toHaveURL(/\/admin\/settings\/community$/);
      await expect(likes).not.toBeChecked();
    }
    const current = await admin.request.get('/api/v1/admin/settings/community');
    const etag = current.headers()['etag'];
    const previous = InteractionSettingsResponseSchema.parse(await current.json());
    expect(
      (
        await browserWrite(
          admin,
          '/api/v1/admin/settings/community',
          { ...previous.data, likesEnabled: true, favoritesEnabled: false },
          'PATCH',
          { 'If-Match': etag ?? '' },
        )
      ).status(),
    ).toBe(200);
    const conflict = admin.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/settings/community') &&
        response.request().method() === 'PATCH',
    );
    await admin.getByRole('button', { name: '保存社区设置', exact: true }).click();
    expect((await conflict).status()).toBe(412);
    await expect(likes).not.toBeChecked();
    await expect(favorites).not.toBeChecked();
    // 回归：旧界面只有错误提示，没有保留输入读取新版本的操作
    await admin.getByRole('button', { name: '读取最新社区设置', exact: true }).click();
    await expect(admin.getByText('当前选项已保留，确认后再次保存', { exact: true })).toBeVisible();
    await expect(likes).not.toBeChecked();
    await expect(favorites).not.toBeChecked();
    await admin.getByRole('button', { name: '保存社区设置', exact: true }).click();
    await expect(admin.getByText('社区设置已保存', { exact: true })).toBeVisible();
    const saved = InteractionSettingsResponseSchema.parse(
      await (await admin.request.get('/api/v1/admin/settings/community')).json(),
    );
    expect(saved.data).toEqual({ ...previous.data, likesEnabled: false, favoritesEnabled: false });
    await capture(admin, info, 'settings-community');
    await page.reload();
    await expect(page.getByRole('button', { name: '点赞', exact: true })).toBeDisabled();
    expect(
      (
        await browserWrite(page, '/api/v1/personas/' + works.maibot.id + '/like', {}, 'PUT')
      ).status(),
    ).toBe(403);
    await page.getByRole('button', { name: '取消收藏', exact: true }).click();
    await expect(page.getByRole('button', { name: '收藏', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  } finally {
    const current = await admin.request.get('/api/v1/admin/settings/community');
    const previous = InteractionSettingsResponseSchema.parse(await current.json());
    expect(
      (
        await browserWrite(
          admin,
          '/api/v1/admin/settings/community',
          { ...previous.data, likesEnabled: true, favoritesEnabled: true },
          'PATCH',
          { 'If-Match': current.headers()['etag'] ?? '' },
        )
      ).status(),
    ).toBe(200);
  }
});
