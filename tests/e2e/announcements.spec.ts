import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { AdminAnnouncementResponseSchema, announcementEtag } from '@personamarket/contracts';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { browserWrite } from '../fixtures/browser-account.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });
test('公告编辑稿保留断网输入，确认发布后公开，撤回同步退出页面和站点地图', async ({
  page,
  browser,
}, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  const baseURL = process.env['PLAYWRIGHT_ORIGIN'];
  if (!baseURL) throw new Error('必须使用隔离测试站点');
  const context = await browser.newContext({ baseURL, viewport: page.viewportSize() });
  const guest = await context.newPage();
  const phase = process.env['ANNOUNCEMENT_CAPTURE_PHASE'] === 'before' ? 'before' : 'after';
  const directory = join('data/tests/announcements', phase, info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  try {
    await loginBrowserAdmin(page);
    const fields = {
      title: '公开创作公告-' + randomUUID().slice(0, 8),
      summary: '给创作者的一封来信',
      body: '欢迎在书页间分享角色灵感\n这是实际发布的第一份公告',
      pinned: false,
    };
    const created = await browserWrite(
      page,
      '/api/v1/admin/announcements',
      { ...fields, reason: '准备实际公告流程' },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(created.status()).toBe(200);
    let row = AdminAnnouncementResponseSchema.parse(await created.json()).data;
    const published = await browserWrite(
      page,
      '/api/v1/admin/announcements/' + row.id + '/publish',
      { reason: '首次核对公开文本', confirmed: true },
      'POST',
      { 'Idempotency-Key': randomUUID(), 'If-Match': announcementEtag(row.id, row.revision) },
    );
    expect(published.status()).toBe(200);
    row = AdminAnnouncementResponseSchema.parse(await published.json()).data;
    for (const [path, label] of [
      ['/admin/announcements', 'management'],
      ['/announcements', 'list'],
      ['/announcements/' + row.id, 'detail'],
    ] as const) {
      await page.goto(path);
      await page.getByRole('heading', { level: 1 }).waitFor();
      if (label === 'management') {
        await expect(page.getByText(fields.title, { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: '刷新公告', exact: true })).toBeEnabled();
      } else if (label === 'list') {
        await expect(page.getByRole('link', { name: fields.title, exact: true })).toBeVisible();
      } else {
        await expect(page.getByRole('heading', { name: fields.title, exact: true })).toBeVisible();
      }
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: join(directory, label + '.png') });
    }
    await guest.goto('/');
    const homeAnnouncements = guest.getByRole('region', { name: '站点公告', exact: true });
    await expect(
      homeAnnouncements.getByRole('link', { name: fields.title, exact: true }),
    ).toBeVisible();
    await homeAnnouncements.scrollIntoViewIfNeeded();
    await guest.screenshot({ path: join(directory, 'home-announcements.png') });
    await page.goto('/admin/announcements');
    await expect(page.getByRole('heading', { name: '公告管理', exact: true })).toBeVisible();
    await page.getByRole('searchbox', { name: '搜索标题或 ID', exact: true }).fill(row.id);
    await page.getByRole('button', { name: '筛选公告', exact: true }).click();
    await page.waitForURL((url) => url.searchParams.get('q') === row.id);
    await page.getByRole('button', { name: '管理公告', exact: true }).click();
    const panel = page.getByRole('dialog', { name: '管理公告', exact: true });
    const privateTitle = '尚未发布的编辑文字';
    const privateBody =
      '新的公告正文\n<img src=x onerror=alert(1)>\nhttps://example.invalid/' + '星光'.repeat(100);
    await panel.getByLabel('公告标题', { exact: true }).fill(privateTitle);
    await panel.getByLabel('公告正文', { exact: true }).fill(privateBody);
    await panel.getByLabel('处理理由', { exact: true }).fill('断网时仍要保留编辑输入');
    const endpoint = '**/api/v1/admin/announcements/' + row.id;
    await page.route(endpoint, (route) =>
      route.request().method() === 'PATCH' ? route.abort('failed') : route.continue(),
    );
    await panel.getByRole('button', { name: '保存编辑稿', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('暂时');
    await expect(panel.getByLabel('公告正文', { exact: true })).toHaveValue(privateBody);
    await page.unroute(endpoint);
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/admin/announcements/' + row.id) &&
        response.request().method() === 'PATCH',
    );
    await panel.getByRole('button', { name: '保存编辑稿', exact: true }).click();
    const savedResponse = await saved;
    expect(savedResponse.status()).toBe(200);
    row = AdminAnnouncementResponseSchema.parse(await savedResponse.json()).data;
    await expect(panel).not.toBeVisible();
    await guest.goto('/');
    await expect(
      homeAnnouncements.getByRole('link', { name: fields.title, exact: true }),
    ).toBeVisible();
    await expect(homeAnnouncements.getByText(privateTitle, { exact: true })).toHaveCount(0);
    await guest.goto('/announcements/' + row.id);
    await expect(
      guest.getByRole('heading', { level: 1, name: fields.title, exact: true }),
    ).toBeVisible();
    await expect(guest.getByText(privateBody, { exact: true })).toHaveCount(0);
    for (const agent of ['Mozilla/5.0', 'Twitterbot/1.0']) {
      const response = await guest.request.get('/announcements/' + row.id, {
        headers: { 'User-Agent': agent },
      });
      expect(response.status()).toBe(200);
      const source = await response.text();
      expect(source).not.toContain(privateTitle);
      const metadata = await guest.evaluate((html) => {
        const document = new DOMParser().parseFromString(html, 'text/html');
        return {
          title: document.title,
          ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute('content'),
          canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
          robots: [...document.querySelectorAll('meta[name="robots"]')].flatMap(
            (element) =>
              element
                .getAttribute('content')
                ?.split(',')
                .map((token) => token.trim()) ?? [],
          ),
        };
      }, source);
      expect(metadata.title).toContain(fields.title);
      expect(metadata.ogTitle).toContain(fields.title);
      expect(metadata.canonical).toBe(
        new URL('/announcements/' + row.id, process.env['PUBLIC_ORIGIN']).href,
      );
      const indexed = process.env['PUBLIC_ORIGIN'] === 'https://market.example.org';
      expect(metadata.robots).toContain(indexed ? 'index' : 'noindex');
      expect(metadata.robots).not.toContain(indexed ? 'noindex' : 'index');
      await writeFile(
        join(
          directory,
          agent.startsWith('Mozilla') ? 'browser-metadata.json' : 'crawler-metadata.json',
        ),
        JSON.stringify({ status: response.status(), ...metadata }, null, 2),
      );
    }
    await page.getByRole('button', { name: '管理公告', exact: true }).click();
    await panel.getByLabel('简短摘要', { exact: true }).fill('由当前页面核对的摘要');
    await panel.getByLabel('处理理由', { exact: true }).fill('并发变化后仍保留当前输入');
    expect(
      (
        await browserWrite(
          page,
          '/api/v1/admin/announcements/' + row.id,
          {
            title: row.title,
            summary: row.summary,
            body: row.body,
            pinned: true,
            reason: '另一份窗口先调整置顶',
          },
          'PATCH',
          { 'Idempotency-Key': randomUUID(), 'If-Match': announcementEtag(row.id, row.revision) },
        )
      ).status(),
    ).toBe(200);
    const conflict = page.waitForResponse(
      (response) =>
        response.url().endsWith('/admin/announcements/' + row.id) &&
        response.request().method() === 'PATCH',
    );
    await panel.getByRole('button', { name: '保存编辑稿', exact: true }).click();
    expect((await conflict).status()).toBe(412);
    await expect(panel.getByLabel('简短摘要', { exact: true })).toHaveValue('由当前页面核对的摘要');
    await panel.getByRole('button', { name: '核对最新公告', exact: true }).click();
    await panel.getByRole('button', { name: '采用最新修订继续核对', exact: true }).click();
    await expect(panel.getByLabel('处理理由', { exact: true })).toHaveValue(
      '并发变化后仍保留当前输入',
    );
    await panel.getByRole('button', { name: '保存编辑稿', exact: true }).click();
    await expect(panel).not.toBeVisible();
    await page.getByRole('button', { name: '管理公告', exact: true }).click();
    await panel.getByLabel('处理理由', { exact: true }).fill('核对编辑稿后明确发布');
    await panel.getByRole('button', { name: '准备发布公告', exact: true }).click();
    const confirmation = page.getByRole('alertdialog');
    await expect(
      confirmation.getByRole('heading', { name: '确认发布公告', exact: true }),
    ).toBeVisible();
    await confirmation.getByRole('button', { name: '确认处理', exact: true }).click();
    await expect(panel).not.toBeVisible();
    await guest.reload();
    await expect(
      guest.getByRole('heading', { level: 1, name: privateTitle, exact: true }),
    ).toBeVisible();
    await expect(guest.getByText(privateBody, { exact: true })).toBeVisible();
    expect(await guest.locator('img[onerror],script[src="x"]').count()).toBe(0);
    await guest.screenshot({ path: join(directory, 'published-detail.png') });
    const sitemap = await guest.request.get('/sitemaps/static.xml');
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain('/announcements/' + row.id);
    await page.getByRole('button', { name: '管理公告', exact: true }).click();
    await panel.getByLabel('处理理由', { exact: true }).fill('撤回后等待进一步整理');
    await panel.getByRole('button', { name: '准备撤回公告', exact: true }).click();
    await confirmation.getByRole('button', { name: '确认处理', exact: true }).click();
    await expect(panel).not.toBeVisible();
    await guest.reload();
    await expect(
      guest.getByRole('heading', { name: '这条公告暂时无法访问', exact: true }),
    ).toBeVisible();
    const unavailable = await guest.request.get('/announcements/' + row.id, {
      headers: { 'User-Agent': 'Twitterbot/1.0' },
    });
    expect([200, 404]).toContain(unavailable.status());
    const unavailableSource = await unavailable.text();
    expect(unavailableSource).not.toContain(privateTitle);
    const robots = await guest.evaluate(
      (source) =>
        [
          ...new DOMParser()
            .parseFromString(source, 'text/html')
            .querySelectorAll('meta[name="robots"]'),
        ].flatMap(
          (element) =>
            element
              .getAttribute('content')
              ?.split(',')
              .map((token) => token.trim()) ?? [],
        ),
      unavailableSource,
    );
    expect(robots).toContain('noindex');
    expect(robots).not.toContain('index');
    expect((await guest.request.get('/api/v1/announcements/' + row.id)).status()).toBe(404);
    await writeFile(
      join(directory, 'withdrawn-document.json'),
      JSON.stringify({ webStatus: unavailable.status(), apiStatus: 404, robots }, null, 2),
    );
    expect(await (await guest.request.get('/sitemaps/static.xml')).text()).not.toContain(
      '/announcements/' + row.id,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await guest.goto('/');
    await expect(homeAnnouncements).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('公告页码落空时区分空页和全站没有消息，并能返回第一页', async ({ page }) => {
  await loginBrowserAdmin(page);
  const title = '用于核对空页的公开消息-' + randomUUID().slice(0, 8);
  const response = await browserWrite(
    page,
    '/api/v1/admin/announcements',
    {
      title,
      summary: '',
      body: '这条公告在第一页真实可见',
      pinned: false,
      reason: '准备分页边界样本',
    },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(response.status()).toBe(200);
  const row = AdminAnnouncementResponseSchema.parse(await response.json()).data;
  expect(
    (
      await browserWrite(
        page,
        '/api/v1/admin/announcements/' + row.id + '/publish',
        {
          reason: '公开后检查失效分页',
          confirmed: true,
        },
        'POST',
        { 'Idempotency-Key': randomUUID(), 'If-Match': announcementEtag(row.id, row.revision) },
      )
    ).status(),
  ).toBe(200);
  await page.goto('/announcements?page=100');
  await expect(page.getByText('这一页没有公开公告', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '返回第一页', exact: true }).click();
  await expect(page).toHaveURL(/\/announcements$/);
  await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
});

test('管理公告空页能保留筛选并返回第一页', async ({ page }) => {
  await loginBrowserAdmin(page);
  const title = '管理空页核对-' + randomUUID().slice(0, 8);
  const response = await browserWrite(
    page,
    '/api/v1/admin/announcements',
    { title, summary: '', body: '保留筛选条件返回第一页', pinned: false, reason: '核对管理分页' },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(response.status()).toBe(200);
  await page.goto('/admin/announcements?page=100&q=' + encodeURIComponent(title) + '&status=draft');
  await expect(page.getByText('这一页没有公告', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回第一页', exact: true }).click();
  await expect(page).not.toHaveURL(/[?&]page=/);
  await expect(page.getByLabel('搜索标题或 ID')).toHaveValue(title);
  await expect(page.getByText(title, { exact: true })).toBeVisible();
});
