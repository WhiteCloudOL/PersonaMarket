import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';
import { AdminPersonaResponseSchema, DraftResponseSchema } from '@personamarket/contracts';
import { browserWrite, loginCreator } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { publishedVisualPersonas } from '../fixtures/visual-personas.js';
import { selectTheme } from '../fixtures/theme.js';

test.use({ trace: 'off', screenshot: 'off' });
let readerContext: BrowserContext, authorContext: BrowserContext, reviewerContext: BrowserContext;
let reader: Page, author: Page;
let works: Awaited<ReturnType<typeof publishedVisualPersonas>>;
const privateTitle = '尚未审核的首页更新不能公开';

test.beforeAll(async ({ browser }, info) => {
  const baseURL = process.env['PLAYWRIGHT_ORIGIN'];
  const database = process.env['TEST_DATABASE_URL'];
  if (!baseURL || !database || !/^\/pm_e2e_[a-f0-9]{32}_test$/.test(new URL(database).pathname))
    throw new Error('需要受控隔离测试站点');
  const mobile = info.project.name === 'mobile';
  readerContext = await browser.newContext({
    baseURL,
    viewport: mobile
      ? { width: 390, height: 844 }
      : info.project.name === 'tablet'
        ? { width: 768, height: 1024 }
        : { width: 1440, height: 900 },
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: 'reduce',
  });
  authorContext = await browser.newContext({ baseURL });
  reviewerContext = await browser.newContext({ baseURL });
  reader = await readerContext.newPage();
  author = await authorContext.newPage();
  const reviewer = await reviewerContext.newPage();
  await loginCreator(author);
  await loginBrowserAdmin(reviewer);
  works = await publishedVisualPersonas(author, reviewer);
  const adminPath = '/api/v1/admin/personas/' + works.maibot.id;
  const managed = AdminPersonaResponseSchema.parse(
    await (await reviewer.request.get(adminPath)).json(),
  ).data;
  expect(
    (
      await browserWrite(
        reviewer,
        adminPath + '/curation',
        {
          featured: true,
          official: false,
          expectedRevision: managed.revision,
          reason: '隔离验收首页模块筛选互不串扰',
        },
        'PUT',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status(),
  ).toBe(200);
  const path = '/api/v1/me/personas/' + works.maibot.id;
  const current = DraftResponseSchema.parse(
    await (await author.request.get(path + '/draft')).json(),
  );
  const savedResponse = await browserWrite(
    author,
    path + '/draft',
    { ...current.data.draft, title: privateTitle },
    'PUT',
    { 'If-Match': '"draft-' + current.meta.revision + '"' },
  );
  expect(savedResponse.status()).toBe(200);
  const saved = DraftResponseSchema.parse(await savedResponse.json());
  expect(
    (
      await browserWrite(
        author,
        path + '/releases',
        {
          version: '1.1.0',
          changelog: '隔离测试未审核更新',
          expectedDraftRevision: saved.meta.revision,
          confirmed: true,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status(),
  ).toBe(200);
});
test.afterAll(async () => {
  try {
    // 失败后Playwright会重建worker，先收起本次夹具，避免旧公开作品污染下次空态检查
    if (author && works) {
      for (const work of [works.maibot, works.astrbot])
        expect(
          (
            await browserWrite(author, '/api/v1/me/personas/' + work.id + '/visibility', {
              visibility: 'hidden',
              reason: '隔离首页平台验收夹具收尾',
            })
          ).status(),
        ).toBe(200);
    }
  } finally {
    await Promise.allSettled([
      readerContext?.close(),
      authorContext?.close(),
      reviewerContext?.close(),
    ]);
  }
});

test('未水合首屏已按平台读取公开数据，入口就绪前禁用且不泄漏未审更新', async ({ browser }) => {
  const origin = process.env['PLAYWRIGHT_ORIGIN'];
  if (!origin) throw new Error('需要隔离测试站点');
  const context = await browser.newContext({ baseURL: origin });
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const page = await context.newPage();
    await page.route(/\/_next\/static\/.*\.js(?:\?|$)/, async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto('/?recentPlatform=astrbot', { waitUntil: 'commit' });
    const recent = page.locator('[data-home-section="recent"]');
    const button = recent.getByRole('button', { name: 'AstrBot', exact: true });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(recent.locator('article')).toHaveCount(1);
    await expect(recent).toContainText(works.astrbot.title);
    await expect(page.locator('#main')).not.toContainText(privateTitle);
    release();
    await page.waitForLoadState('load');
    await expect(button).toBeEnabled();
    await recent.getByRole('button', { name: '全部', exact: true }).click();
    await expect(recent.locator('article')).toHaveCount(2);
  } finally {
    release();
    await context.close();
  }
});

test('首页就地筛选真实新作，刷新、历史和查看全部保留平台语义', async () => {
  await reader.goto('/?from=home-platform-review');
  const recent = reader.locator('[data-home-section="recent"]');
  const filter = recent.getByRole('group', { name: '新近发布的平台', exact: true });
  await expect(filter).toBeVisible();
  await expect(recent.locator('article')).toHaveCount(2);
  const featured = reader.getByRole('region', { name: '精选人设', exact: true });
  const total = await reader.getByTestId('stat-personas').innerText();
  await expect(featured.locator('article')).toHaveCount(1);
  await expect(featured).toContainText(works.maibot.title);
  for (const [platform, label] of [
    ['maibot', 'MaiBot'],
    ['astrbot', 'AstrBot'],
  ] as const) {
    const button = filter.getByRole('button', { name: label, exact: true });
    await button.click();
    await expect(reader).toHaveURL(new RegExp('recentPlatform=' + platform));
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(recent.locator('article')).toHaveCount(1);
    await expect(recent).toContainText(works[platform].title);
    await expect(recent).not.toContainText(privateTitle);
    await expect(featured.locator('article')).toHaveCount(1);
    await expect(featured).toContainText(works.maibot.title);
    await expect(reader.getByTestId('stat-personas')).toHaveText(total);
    await expect(recent.getByRole('link', { name: '查看全部', exact: true })).toHaveAttribute(
      'href',
      '/explore?platform=' + platform,
    );
    expect(new URL(reader.url()).searchParams.get('from')).toBe('home-platform-review');
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(recent.locator('article')).toHaveCount(1);
  }
  await reader.reload();
  await expect(filter.getByRole('button', { name: 'AstrBot', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(recent.locator('article')).toHaveCount(1);
  await reader.goBack();
  await expect(filter.getByRole('button', { name: 'MaiBot', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(recent).toContainText(works.maibot.title);
  await filter.getByRole('button', { name: '全部', exact: true }).click();
  await expect(recent.locator('article')).toHaveCount(2);
  expect(new URL(reader.url()).searchParams.has('recentPlatform')).toBe(false);
  expect(new URL(reader.url()).searchParams.get('from')).toBe('home-platform-review');
  for (const query of [
    '?recentPlatform=unknown',
    '?recentPlatform=maibot&recentPlatform=astrbot',
  ]) {
    await reader.goto('/' + query);
    await expect(filter.getByRole('button', { name: '全部', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(recent.locator('article')).toHaveCount(2);
    await expect(recent).not.toContainText(privateTitle);
  }
});

test('新作平台控制在触控、大字和键盘下可用，文字不越出按钮', async () => {
  await reader.goto('/');
  const filter = reader.getByRole('group', { name: '新近发布的平台', exact: true });
  await expect(filter.getByRole('button', { name: '全部', exact: true })).toBeEnabled();
  for (const size of [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 960, height: 800 },
    { width: 1024, height: 768 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await reader.setViewportSize(size);
    await reader.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await filter.scrollIntoViewIfNeeded();
    const bounds = await filter.getByRole('button').evaluateAll((buttons) =>
      buttons.map((button) => {
        const box = button.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(button);
        return {
          width: box.width,
          height: box.height,
          contained: [...range.getClientRects()].every(
            (text) =>
              text.left >= box.left - 1 &&
              text.right <= box.right + 1 &&
              text.top >= box.top - 1 &&
              text.bottom <= box.bottom + 1,
          ),
        };
      }),
    );
    expect(bounds).toHaveLength(3);
    expect(
      bounds.every((item) => item.width >= 44 && item.height >= 44 && item.contained),
      JSON.stringify({ size, bounds }),
    ).toBe(true);
    expect(await reader.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
  }
  await reader.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
  await selectTheme(reader, 'dark');
  const all = filter.getByRole('button', { name: '全部', exact: true });
  const maibot = filter.getByRole('button', { name: 'MaiBot', exact: true });
  await all.focus();
  await reader.keyboard.press('ArrowRight');
  await expect(maibot).toBeFocused();
  await reader.keyboard.press('Space');
  await expect(maibot).toHaveAttribute('aria-pressed', 'true');
  await expect(reader.locator('[data-home-section="recent"] article')).toHaveCount(1);
  await expect(maibot).toBeFocused();
  if (test.info().project.name === 'mobile') {
    await reader.setViewportSize({ width: 390, height: 844 });
    await filter.getByRole('button', { name: 'AstrBot', exact: true }).tap();
    await expect(reader.locator('[data-home-section="recent"]')).toContainText(works.astrbot.title);
  }
});

test('延迟的旧筛选请求不会覆盖最新的平台选择', async () => {
  await reader.goto('/');
  const recent = reader.locator('[data-home-section="recent"]');
  const filter = recent.getByRole('group', { name: '新近发布的平台', exact: true });
  let release = () => {},
    observed = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const seen = new Promise<void>((resolve) => {
    observed = resolve;
  });
  let held = false;
  const delay = async (route: Route) => {
    const url = new URL(route.request().url());
    if (
      !held &&
      url.pathname === '/' &&
      url.searchParams.get('recentPlatform') === 'maibot' &&
      route.request().headers()['rsc'] === '1'
    ) {
      held = true;
      observed();
      await gate;
    }
    await route.continue();
  };
  await reader.route('**/*', delay);
  try {
    await filter.getByRole('button', { name: 'MaiBot', exact: true }).click();
    await seen;
    await expect(filter).toHaveAttribute('aria-busy', 'true');
    await expect(filter.getByRole('button', { name: 'MaiBot', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await filter.getByRole('button', { name: 'AstrBot', exact: true }).click();
    await expect(recent.locator('article')).toHaveCount(1);
    await expect(recent).toContainText(works.astrbot.title);
  } finally {
    release();
    await reader.unrouteAll({ behavior: 'wait' });
  }
  await expect(filter).toHaveAttribute('aria-busy', 'false');
  await expect(filter.getByRole('button', { name: 'AstrBot', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(new URL(reader.url()).searchParams.get('recentPlatform')).toBe('astrbot');
  await expect(recent).toContainText(works.astrbot.title);
});

test('隐藏作品退出所选平台，空态能返回其他公开平台且未审更新隔离', async () => {
  expect(
    (
      await browserWrite(author, '/api/v1/me/personas/' + works.astrbot.id + '/visibility', {
        visibility: 'hidden',
        reason: '隔离验收首页筛选公开边界',
      })
    ).status(),
  ).toBe(200);
  await reader.goto('/?recentPlatform=astrbot');
  const recent = reader.locator('[data-home-section="recent"]');
  await expect(recent.locator('article')).toHaveCount(0);
  await expect(recent).toContainText('AstrBot 还没有公开作品');
  await expect(recent).not.toContainText(works.astrbot.title);
  await recent.getByRole('button', { name: '全部', exact: true }).click();
  await expect(recent.locator('article')).toHaveCount(1);
  await expect(recent).toContainText(works.maibot.title);
  await expect(reader.locator('#main')).not.toContainText(privateTitle);
});
