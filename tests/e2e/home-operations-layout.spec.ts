import { selectTheme } from '../fixtures/theme.js';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createDatabase } from '@personamarket/database';
import {
  AdminPersonaResponseSchema,
  AdminAnnouncementResponseSchema,
  HomeSettingsResponseSchema,
  homeSettingsEtag,
  announcementEtag,
} from '@personamarket/contracts';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { browserWrite, loginCreator } from '../fixtures/browser-account.js';
import { publishedVisualPersonas } from '../fixtures/visual-personas.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });
test('首页运营长内容在重点视口可用，五条真实内容、确认焦点和故障恢复正确', async ({
  page,
  browser,
}, info) => {
  const baseURL = process.env['PLAYWRIGHT_ORIGIN'];
  if (!baseURL) throw new Error('必须使用隔离测试站点');
  const directory = join('data/tests/home-operations-layout', info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  const creatorContext = await browser.newContext({ baseURL });
  const guestContext = await browser.newContext({ baseURL });
  let release: (() => void) | undefined;
  try {
    const creator = await creatorContext.newPage(),
      guest = await guestContext.newPage();
    await guest.goto('/admin/settings/home');
    await expect(guest.getByText('此页面需要管理员权限', { exact: true })).toBeVisible();
    expect((await guest.request.get('/api/v1/admin/settings/home')).status()).toBe(401);
    await loginCreator(creator);
    await creator.goto('/admin/settings/home');
    await expect(creator.getByText('此页面需要管理员权限', { exact: true })).toBeVisible();
    expect((await creator.request.get('/api/v1/admin/settings/home')).status()).toBe(403);
    await loginBrowserAdmin(page);
    for (const number of [1, 2, 3]) {
      const works = await publishedVisualPersonas(creator, page, {
        titles: {
          maibot: '星光回信' + number + '创作之旅'.repeat(12),
          astrbot: '书页之约' + number + '创作之旅'.repeat(12),
        },
        summary: 'https://example.invalid/' + 'long-story-'.repeat(15),
      });
      for (const work of [works.maibot, works.astrbot]) {
        const path = '/api/v1/admin/personas/' + work.id;
        const current = AdminPersonaResponseSchema.parse(
          await (await page.request.get(path)).json(),
        ).data;
        expect(
          (
            await browserWrite(
              page,
              path + '/curation',
              {
                featured: true,
                official: false,
                expectedRevision: current.revision,
                reason: '核对超过四条的真实展示',
              },
              'PUT',
              { 'Idempotency-Key': randomUUID() },
            )
          ).status(),
        ).toBe(200);
      }
    }
    for (const number of [1, 2, 3, 4, 5, 6]) {
      const created = await browserWrite(
        page,
        '/api/v1/admin/announcements',
        {
          title: '阅读提醒' + number + '星光'.repeat(60),
          summary: '保留真实消息的完整阅读入口',
          body: '由隔离站点实际保存并确认发布',
          pinned: number === 1,
          reason: '准备数量和长标题核对',
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      );
      expect(created.status()).toBe(200);
      const row = AdminAnnouncementResponseSchema.parse(await created.json()).data;
      expect(
        (
          await browserWrite(
            page,
            '/api/v1/admin/announcements/' + row.id + '/publish',
            { reason: '核对后公开消息', confirmed: true },
            'POST',
            { 'Idempotency-Key': randomUUID(), 'If-Match': announcementEtag(row.id, row.revision) },
          )
        ).status(),
      ).toBe(200);
    }
    const initial = HomeSettingsResponseSchema.parse(
      await (await page.request.get('/api/v1/admin/settings/home')).json(),
    );
    const note =
      '星光创作'.repeat(30) + ' <img src=x onerror=alert(1)> https://example.invalid/long-story';
    expect(
      (
        await browserWrite(
          page,
          '/api/v1/admin/settings/home',
          {
            data: {
              ...initial.data,
              heroNote: note,
              featuredCount: 5,
              recentCount: 5,
              announcementCount: 5,
            },
            reason: '核对五条内容和长文案布局',
          },
          'PATCH',
          { 'Idempotency-Key': randomUUID(), 'If-Match': homeSettingsEtag(initial.meta.revision) },
        )
      ).status(),
    ).toBe(200);
    await page.goto('/admin/settings/home');
    await expect(page.getByLabel('首页短提示', { exact: true })).toHaveValue(note);
    await guest.goto('/');
    await expect(guest.getByText(note, { exact: true })).toBeVisible();
    await expect(
      guest
        .getByRole('navigation', { name: '账号导航', exact: true })
        .getByRole('link', { name: '登录', exact: true }),
    ).toBeVisible();
    expect(await guest.locator('img[src="x"]').count()).toBe(0);
    for (const region of ['精选人设', '新近发布'])
      await expect(
        guest
          .getByRole('region', { name: region, exact: true })
          .getByRole('link', { name: '登录后收藏', exact: true }),
      ).toHaveCount(5);
    await expect(
      guest
        .getByRole('region', { name: '站点公告', exact: true })
        .getByRole('link', { name: /^阅读提醒/ }),
    ).toHaveCount(5);
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
      await guest.setViewportSize({ width, height });
      await page.evaluate(() => window.scrollTo(0, 0));
      await guest.evaluate(() => window.scrollTo(0, 0));
      await page.evaluate(() => document.fonts.ready);
      await guest.evaluate(() => document.fonts.ready);
      const adminOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      );
      const publicOverflow = await guest.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      );
      expect(adminOverflow).toBe(false);
      expect(publicOverflow).toBe(false);
      expect(await page.locator('header').count()).toBe(1);
      const targetHeight = await page
        .getByRole('button', { name: '精选人设下移', exact: true })
        .evaluate((element) => element.getBoundingClientRect().height);
      expect(targetHeight).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: join(directory, width + 'x' + height + '-settings.png') });
      await guest.screenshot({ path: join(directory, width + 'x' + height + '-home.png') });
      measurements.push({ width, height, adminOverflow, publicOverflow, targetHeight });
    }
    const viewport =
      info.project.name === 'desktop'
        ? { width: 1440, height: 900 }
        : info.project.name === 'mobile'
          ? { width: 390, height: 844 }
          : { width: 768, height: 1024 };
    await page.setViewportSize(viewport);
    await guest.setViewportSize(viewport);
    for (const target of [page, guest]) {
      await selectTheme(target, 'dark');
      await target.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      expect(await target.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
    }
    const preview = page.getByRole('button', { name: '预览默认设置', exact: true });
    await preview.click();
    const dialog = page.getByRole('alertdialog', { name: '预览首页默认设置', exact: true });
    const comparison = dialog.getByRole('region', { name: '首页默认设置对照', exact: true });
    await comparison.focus();
    await comparison.press('End');
    await expect.poll(() => comparison.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(
      dialog.getByRole('heading', { name: '预览首页默认设置', exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole('button', { name: '填入默认值', exact: true })).toBeInViewport({
      ratio: 1,
    });
    expect(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
      false,
    );
    await page.screenshot({ path: join(directory, 'dark-large-defaults.png') });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(preview).toBeFocused();
    const bookmark = guest
      .getByRole('region', { name: '精选人设', exact: true })
      .getByRole('link', { name: '登录后收藏', exact: true })
      .last();
    await bookmark.scrollIntoViewIfNeeded();
    await bookmark.focus();
    await expect(bookmark).toBeInViewport({ ratio: 1 });
    expect(
      await bookmark.evaluate((element) => element.getBoundingClientRect().height),
    ).toBeGreaterThanOrEqual(44);
    expect(
      await bookmark.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
        );
      }),
    ).toBe(true);
    await guest.screenshot({ path: join(directory, 'dark-large-featured.png') });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
    await page.getByLabel('首页短提示', { exact: true }).fill('确认保存后保留的首页提示');
    await page
      .getByLabel('首页短提示', { exact: true })
      .fill('保留长理由与有限空间中的输入'.repeat(80));
    await page.setViewportSize({ width: 390, height: 480 });
    const reason = page.getByLabel('首页短提示', { exact: true });
    await reason.scrollIntoViewIfNeeded();
    await reason.focus();
    await expect(reason).toBeInViewport({ ratio: 1 });
    const inputBox = await reason.boundingBox();
    const saveBox = await page
      .getByRole('button', { name: '保存首页设置', exact: true })
      .evaluate((element) => {
        const box = element.parentElement?.getBoundingClientRect();
        return box ? { y: box.y } : null;
      });
    if (!inputBox || !saveBox) throw new Error('缺少真实输入框或保存操作区域');
    expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(saveBox.y);
    expect(
      await reason.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
        );
      }),
    ).toBe(true);
    await page.screenshot({ path: join(directory, 'limited-height-input.png') });
    await page.setViewportSize(viewport);
    const invalidWrites: string[] = [];
    page.on('request', (request) => {
      if (
        request.method() === 'PATCH' &&
        new URL(request.url()).pathname === '/api/v1/admin/settings/home'
      )
        invalidWrites.push(request.url());
    });
    await page.getByRole('button', { name: '保存首页设置', exact: true }).click();
    await expect(reason).toHaveAttribute('aria-invalid', 'true');
    expect(invalidWrites).toEqual([]);
    const savedHint = (
      '确认保存后保留的首页提示' + '保留长提示与有限空间中的输入'.repeat(20)
    ).slice(0, 200);
    await reason.fill(savedHint);
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let intercepted = false;
    await page.route('**/api/v1/admin/settings/home', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      intercepted = true;
      await held;
      await route.continue();
    });
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/admin/settings/home') && response.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: '保存首页设置', exact: true }).click();
    await expect.poll(() => intercepted).toBe(true);
    await expect(page.getByLabel('首页短提示', { exact: true })).toBeDisabled();
    await expect(preview).toBeDisabled();
    await expect(page.getByRole('button', { name: '正在保存…', exact: true })).toBeDisabled();
    release?.();
    expect((await saved).status()).toBe(200);
    await expect(page.getByLabel('首页短提示', { exact: true })).toBeEnabled();
    const url = process.env['TEST_DATABASE_URL'];
    if (!url || !/^\/pm_e2e_[a-f0-9]{32}_test$/.test(new URL(url).pathname))
      throw new Error('故障注入只允许本轮隔离库');
    const database = createDatabase(url);
    try {
      const before = (
        await database.pool.query<{ value: unknown }>(
          "SELECT value FROM site_settings WHERE key='home'",
        )
      ).rows[0];
      if (!before) throw new Error('缺少首页设置');
      try {
        await database.pool.query("UPDATE site_settings SET value='{}'::jsonb WHERE key='home'");
        await guest.goto('/');
        await expect(guest.getByText('首页展示设置暂时不可用', { exact: true })).toBeVisible();
        await expect(guest.locator('[data-home-section]')).toHaveCount(0);
      } finally {
        await database.pool.query("UPDATE site_settings SET value=$1 WHERE key='home'", [
          before.value,
        ]);
      }
    } finally {
      await database.close();
    }
    await guest.reload();
    await expect(guest.getByText(savedHint, { exact: true })).toBeVisible();
    await writeFile(
      join(directory, 'measurements.json'),
      JSON.stringify(
        {
          environment:
            'Chromium viewports, 200% root font; reduced viewport height is not a real system keyboard',
          measurements,
        },
        null,
        2,
      ),
    );
  } finally {
    release?.();
    await creatorContext.close();
    await guestContext.close();
  }
});
