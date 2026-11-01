import { randomUUID } from 'node:crypto';
import { expect, test, type Locator } from '@playwright/test';
import {
  AdminPersonaResponseSchema,
  HomeSettingsResponseSchema,
  homeSettingsEtag,
} from '@personamarket/contracts';
import { browserWrite, loginCreator } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { publishedVisualPersonas } from '../fixtures/visual-personas.js';

test.use({ trace: 'off', screenshot: 'off' });

async function cardRows(region: Locator) {
  return region.locator('article').evaluateAll((cards) => {
    const boxes = cards.map((card) => card.getBoundingClientRect());
    const grid = cards[0]?.parentElement?.getBoundingClientRect();
    const rows: number[] = [];
    const tops: number[] = [];
    for (const box of boxes) {
      let row = tops.findIndex((top) => Math.abs(top - box.top) < 2);
      if (row < 0) {
        row = tops.length;
        tops.push(box.top);
        rows.push(0);
      }
      rows[row] = (rows[row] ?? 0) + 1;
    }
    const first = boxes[0];
    const firstRow = first ? boxes.filter((box) => Math.abs(first.top - box.top) < 2) : [];
    return {
      rows,
      use:
        grid && first
          ? (Math.max(...firstRow.map((box) => box.right)) - first.left) / grid.width
          : 0,
    };
  });
}

test('首页从空态到单条、双条和多条真实作品时合理使用区域并保留公开链接和互动', async ({
  page,
  browser,
}, info) => {
  const origin = process.env['PLAYWRIGHT_ORIGIN'];
  if (!origin) throw new Error('必须使用隔离测试站点');
  const mobile = info.project.name === 'mobile';
  const viewport = mobile
    ? { width: 390, height: 844 }
    : info.project.name === 'tablet'
      ? { width: 768, height: 1024 }
      : { width: 1440, height: 900 };
  const authorContext = await browser.newContext({ baseURL: origin });
  const guestContext = await browser.newContext({
    baseURL: origin,
    viewport,
    isMobile: mobile,
    hasTouch: mobile,
  });
  const author = await authorContext.newPage();
  const guest = await guestContext.newPage();
  try {
    await loginCreator(author);
    await loginBrowserAdmin(page);
    const settings = HomeSettingsResponseSchema.parse(
      await (await page.request.get('/api/v1/admin/settings/home')).json(),
    );
    expect(
      (
        await browserWrite(
          page,
          '/api/v1/admin/settings/home',
          {
            data: { ...settings.data, recentCount: 8, featuredCount: 8 },
            reason: '核对真实作品数量变化时的首页阅读布局',
          },
          'PATCH',
          { 'If-Match': homeSettingsEtag(settings.meta.revision), 'Idempotency-Key': randomUUID() },
        )
      ).status(),
    ).toBe(200);
    async function check(count: number) {
      await guest.goto('/');
      await expect(guest.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(guest.getByTestId('stat-personas')).toHaveText(String(count));
      const recent = guest.locator('[data-home-section="recent"]');
      const featured = guest.locator('[data-home-section="featured"]');
      await expect(recent).toBeVisible();
      await expect(recent.locator('article')).toHaveCount(count);
      if (count === 0) {
        await expect(featured).toHaveCount(0);
        await expect(recent.getByRole('link', { name: '分享我的角色', exact: true })).toBeVisible();
        return;
      }
      for (const region of [recent, featured]) {
        await expect(region.locator('article')).toHaveCount(count);
        await expect(region.locator('article').first()).toBeVisible();
        const { use, rows } = await cardRows(region);
        expect(use).toBeGreaterThan(0.98);
        expect(Math.max(...rows) - Math.min(...rows)).toBeLessThanOrEqual(1);
        for (const card of await region.locator('article').all()) {
          await expect(card.getByRole('link').first()).toHaveAttribute(
            'href',
            /^\/personas\/[0-9a-f-]{36}$/,
          );
          for (const label of ['点赞', '收藏']) {
            const login = card.getByRole('link', { name: '登录后' + label, exact: true });
            await expect(login).toBeVisible();
            await expect(login).toHaveAttribute('href', '/login');
            await expect(login).toHaveAttribute('title', '当前' + label + '总数 0');
          }
        }
        const firstCard = region.locator('article').first();
        const box = await firstCard.boundingBox();
        if (count === 1 && box && box.width > 700) {
          const image = await firstCard.locator('img').boundingBox();
          expect(image).not.toBeNull();
          expect((image?.width ?? 0) / box.width).toBeGreaterThan(0.15);
          expect((image?.width ?? 0) / box.width).toBeLessThan(0.4);
        }
      }
      expect(await guest.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
    }
    async function publish(pair: number) {
      const works = await publishedVisualPersonas(author, page, {
        titles: { maibot: '春日书房 · 真实来信 ' + pair, astrbot: '星光旅途 · 真实回响 ' + pair },
      });
      for (const work of [works.maibot, works.astrbot]) {
        const path = '/api/v1/admin/personas/' + work.id;
        const item = AdminPersonaResponseSchema.parse(
          await (await page.request.get(path)).json(),
        ).data;
        expect(
          (
            await browserWrite(
              page,
              path + '/curation',
              {
                official: false,
                featured: true,
                expectedRevision: item.revision,
                reason: '核对真实获批作品的首页展示',
              },
              'PUT',
              { 'Idempotency-Key': randomUUID() },
            )
          ).status(),
        ).toBe(200);
      }
      return works;
    }
    await check(0);
    const first = await publish(1);
    const visibility = (value: 'hidden' | 'listed') =>
      browserWrite(author, '/api/v1/me/personas/' + first.astrbot.id + '/visibility', {
        visibility: value,
        reason: '核对作者展示状态和稀疏列表布局',
      });
    expect((await visibility('hidden')).status()).toBe(200);
    await check(1);
    const single = guest.locator('[data-home-section="recent"] article').first();
    await single.getByRole('link').first().focus();
    await guest.keyboard.press('Tab');
    await expect(single.getByRole('link', { name: '登录后点赞', exact: true })).toBeFocused();
    await guest.keyboard.press('Tab');
    await expect(single.getByRole('link', { name: '登录后收藏', exact: true })).toBeFocused();
    await guest.keyboard.press('Enter');
    await expect(guest).toHaveURL(/\/login$/);
    expect((await guest.request.get('/api/v1/personas/' + first.astrbot.id)).status()).toBe(404);
    expect((await visibility('listed')).status()).toBe(200);
    await check(2);
    await publish(2);
    await check(4);
    await publish(3);
    await check(6);
    expect((await guest.request.get('/api/v1/me/personas')).status()).toBe(401);
  } finally {
    await authorContext.close();
    await guestContext.close();
  }
});

test('首页大字标题保持完整词组并且不会留下单字一行', async ({ page }, info) => {
  const sizes =
    info.project.name === 'mobile'
      ? [
          { width: 390, height: 844 },
          { width: 360, height: 800 },
        ]
      : [
          info.project.name === 'tablet'
            ? { width: 768, height: 1024 }
            : { width: 1440, height: 900 },
        ];
  for (const viewport of sizes) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
      return document.fonts.ready;
    });
    const headings = page.locator(
      '[data-home-section="recent"] h2,[data-home-section="featured"] h2',
    );
    expect(await headings.count()).toBeGreaterThanOrEqual(1);
    for (const heading of await headings.all()) {
      const lines = await heading.evaluate((element) => {
        const text = element.firstChild;
        if (!text || text.nodeType !== Node.TEXT_NODE) throw new Error('缺少分组标题文字');
        const rows = new Map<number, number>();
        const range = document.createRange();
        for (let index = 0; index < (text.textContent?.length ?? 0); index++) {
          range.setStart(text, index);
          range.setEnd(text, index + 1);
          const top = Math.round(range.getBoundingClientRect().top);
          rows.set(top, (rows.get(top) ?? 0) + 1);
        }
        return [...rows.values()];
      });
      expect(Math.min(...lines)).toBeGreaterThanOrEqual(2);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
  }
});
