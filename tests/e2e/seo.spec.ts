import { expect, test, type BrowserContext, type Page, type APIResponse } from '@playwright/test';
import { createDatabase } from '@personamarket/database';
import { mkdir, writeFile } from 'node:fs/promises';
import { PublicReleaseResponseSchema, DraftResponseSchema } from '@personamarket/contracts';
import { loginCreator, browserWrite } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { visualPersonas } from '../fixtures/visual-personas.js';

test.use({ trace: 'off', screenshot: 'off' });
let authorContext: BrowserContext;
let adminContext: BrowserContext;
let author: Page;
let works: Awaited<ReturnType<typeof visualPersonas>>;
let draftId: string;
const title = '星光<&"诗织🌟';
// 额外的公开模式回归使用此受控origin，仅检查标签，不访问该外部域名
const publicMode = process.env['PUBLIC_ORIGIN'] === 'https://market.example.org';
test.beforeAll(async ({ browser }) => {
  const options = { baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100' };
  authorContext = await browser.newContext(options);
  adminContext = await browser.newContext(options);
  author = await authorContext.newPage();
  const admin = await adminContext.newPage();
  await loginCreator(author);
  await loginBrowserAdmin(admin);
  works = await visualPersonas(author, admin, {
    titles: { maibot: title },
    summary: '真实分享简介 & 中文 <星光>',
  });
  const draft = await browserWrite(author, '/api/v1/me/personas', {
    platform: 'maibot',
    title: '未公开的SEO隔离草稿',
  });
  expect(draft.status()).toBe(200);
  draftId = DraftResponseSchema.parse(await draft.json()).data.id;
});
test.afterAll(async () => {
  try {
    if (works && author && !author.isClosed()) {
      for (const work of [works.maibot, works.astrbot])
        expect(
          (
            await browserWrite(author, '/api/v1/me/personas/' + work.id + '/visibility', {
              visibility: 'hidden',
              reason: '关闭本轮SEO隔离样本',
            })
          ).status(),
        ).toBe(200);
    }
  } finally {
    await Promise.all([adminContext?.close(), authorContext?.close()]);
  }
});
const publicUrl = (path: string) => new URL(path, process.env['PUBLIC_ORIGIN']).href;
async function xml(page: Page, response: APIResponse) {
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(response.headers()['content-type']).toContain('application/xml');
  return page.evaluate(
    (source) => {
      const document = new DOMParser().parseFromString(source, 'application/xml');
      if (document.querySelector('parsererror')) throw new Error('站点地图XML格式错误');
      return {
        root: document.documentElement.localName,
        urls: [...document.querySelectorAll('loc')].map((element) => element.textContent),
        dates: [...document.querySelectorAll('lastmod')].map((element) => element.textContent),
      };
    },
    await response.text(),
  );
}
async function metadata(page: Page) {
  // 普通浏览器可接收body中的流式元数据，社交爬虫的初始head另有独立断言
  try {
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
  } catch (cause) {
    await mkdir('data/tests/seo', { recursive: true });
    await writeFile(
      'data/tests/seo/canonical-' +
        test.info().project.name +
        '-' +
        test.info().repeatEachIndex +
        '.html',
      await page.content(),
    );
    throw cause;
  }
  return page.evaluate(() => ({
    title: document.title,
    description: document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content,
    canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href,
    ogUrl: document.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.content,
    image: document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content,
    robots: document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content,
    twitter: document.querySelector<HTMLMetaElement>('meta[name="twitter:card"]')?.content,
  }));
}
async function unavailableDocument(page: Page, response: APIResponse, excludedTitle: string) {
  // Next的loading/Suspense可先发送200，错误文档必须仍为noindex且不含私有内容
  expect([200, 404]).toContain(response.status());
  expect(response.headers()['cache-control']).toContain('no-store');
  const result = await page.evaluate(
    (source) => {
      const document = new DOMParser().parseFromString(source, 'text/html');
      return {
        title: document.title,
        image: document.querySelector('meta[property="og:image"]')?.getAttribute('content'),
        robots: [...document.querySelectorAll('meta[name="robots"]')].map((meta) =>
          meta
            .getAttribute('content')
            ?.split(',')
            .map((token) => token.trim()),
        ),
        text: document.body.textContent,
      };
    },
    await response.text(),
  );
  expect(result.title).not.toContain(excludedTitle);
  expect(result.text).not.toContain(excludedTitle);
  expect(result.image).toBeUndefined();
  expect(result.robots.some((tokens) => tokens?.includes('noindex'))).toBe(true);
  expect(result.robots.some((tokens) => tokens?.includes('index'))).toBe(false);
  // 流式fallback可能由React还原，实际错误界面使用真实浏览器验证
  await page.goto(response.url());
  await expect(
    page.getByRole('heading', { name: '这个作品暂时无法访问', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(excludedTitle, { exact: true })).toHaveCount(0);
  expect(
    await page.locator('meta[name="robots"]').evaluateAll((elements) =>
      elements.some((element) =>
        element
          .getAttribute('content')
          ?.split(',')
          .map((token) => token.trim())
          .includes('index'),
      ),
    ),
  ).toBe(false);
}

test('真实公开页面和不可变版本有独立元数据与分享链接，私有页面保持noindex', async ({ page }) => {
  for (const [path, label] of [
    ['/', '清蒸云鸭'],
    ['/explore', '探索人设'],
    ['/guides', '使用指南'],
    ['/rankings', '人设排行榜'],
    ['/announcements', '站点公告'],
  ] as const) {
    await page.goto(path);
    const info = await metadata(page);
    expect(info.title).toContain(label);
    expect(info.canonical).toBe(publicUrl(path));
    expect(info.ogUrl).toBe(info.canonical);
    expect(info.twitter).toBe('summary_large_image');
    expect(info.robots).toBe(publicMode ? 'index, follow' : 'noindex, nofollow');
  }
  await page.goto('/explore?q=' + encodeURIComponent('中文星光') + '&page=2');
  expect((await metadata(page)).canonical).toBe(publicUrl('/explore'));
  expect((await metadata(page)).robots).toContain('noindex');
  await page.goto(
    '/rankings?kind=downloads&window=all&platform=astrbot&page=2&snapshotId=' + works.maibot.id,
  );
  const ranking = await metadata(page);
  expect(ranking.canonical).toBe(publicUrl('/rankings?kind=downloads&window=all&platform=astrbot'));
  expect(ranking.robots).toContain('noindex');
  const currentPath = '/personas/' + works.maibot.id;
  await page.goto(currentPath);
  const current = await metadata(page);
  expect(current.title).toContain(title);
  expect(current.description).toBe('真实分享简介 & 中文 <星光>');
  expect(current.canonical).toBe(publicUrl(currentPath));
  const release = PublicReleaseResponseSchema.parse(
    await (await page.request.get('/api/v1/personas/' + works.maibot.id)).json(),
  ).data;
  expect(current.image).toBe(publicUrl('/api/v1/public/assets/' + release.snapshot.coverAssetId));
  const versionPath = currentPath + '/releases/' + works.maibot.releaseId;
  await page.goto(versionPath);
  const version = await metadata(page);
  expect(version.title).toContain('v1.0.0');
  expect(version.canonical).toBe(publicUrl(versionPath));
  expect(version.robots).toContain('noindex');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: '分享', exact: true }).click();
  await expect(page.getByRole('button', { name: '已复制', exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    new URL(versionPath, page.url()).href,
  );
  const crawler = await page.request.get(currentPath, {
    headers: { 'user-agent': 'Twitterbot', 'x-forwarded-host': 'attacker.invalid' },
  });
  expect(crawler.status()).toBe(200);
  const crawlerHead = await page.evaluate(
    (source) => {
      const document = new DOMParser().parseFromString(source, 'text/html');
      return {
        title: document.querySelector('head title')?.textContent,
        canonical: document.querySelector('head link[rel="canonical"]')?.getAttribute('href'),
      };
    },
    await crawler.text(),
  );
  expect(crawlerHead.title).toContain(title);
  expect(crawlerHead.canonical).toBe(publicUrl(currentPath));
  await page.goto('/login');
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await page.goto('/admin/moderation');
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  const robots = await page.request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  const rules = (await robots.text()).split(/\r?\n/);
  if (publicMode) {
    expect(rules).toContain('Allow: /');
    expect(rules).not.toContain('Disallow: /');
    expect(rules).toContain('Disallow: /dashboard');
    expect(rules).toContain('Sitemap: ' + publicUrl('/sitemap.xml'));
  } else expect(rules).toContain('Disallow: /');
});
test('真实sitemap索引、固定页和公开作品分片，读取锁失败返回503后可恢复', async ({ page }) => {
  const index = await xml(page, await page.request.get('/sitemap.xml'));
  expect(index.root).toBe('sitemapindex');
  expect(index.urls).toEqual([
    publicUrl('/sitemaps/static.xml'),
    publicUrl('/sitemaps/personas/1.xml'),
  ]);
  const fixed = await xml(page, await page.request.get('/sitemaps/static.xml'));
  expect(fixed.root).toBe('urlset');
  expect(fixed.urls).toEqual(
    [
      '/',
      '/explore',
      '/rankings',
      '/guides',
      '/announcements',
      '/guides/getting-started',
      '/guides/maibot',
      '/guides/astrbot',
      '/guides/create-draft',
      '/guides/images-readme',
      '/guides/source-license',
      '/guides/publish',
      '/guides/import-files',
      '/guides/troubleshooting',
    ].map(publicUrl),
  );
  expect(fixed.dates).toHaveLength(9);
  const entries = await xml(page, await page.request.get('/sitemaps/personas/1.xml'));
  expect(entries.root).toBe('urlset');
  expect(new Set(entries.urls)).toEqual(
    new Set([works.maibot.id, works.astrbot.id].map((id) => publicUrl('/personas/' + id))),
  );
  expect(entries.dates).toHaveLength(2);
  for (const path of [
    '/sitemaps/personas/0.xml',
    '/sitemaps/personas/50000.xml',
    '/sitemaps/personas/1.json',
  ])
    expect((await page.request.get(path)).status()).toBe(404);
  const url = process.env['TEST_DATABASE_URL'];
  if (!url || !/^\/pm_e2e_[a-f0-9]{32}_test$/.test(new URL(url).pathname))
    throw new Error('站点地图回归只允许本轮隔离库');
  const database = createDatabase(url);
  const keeper = await database.pool.connect();
  try {
    await keeper.query('BEGIN');
    await keeper.query('LOCK TABLE personas IN ACCESS EXCLUSIVE MODE');
    const failed = await page.request.get('/sitemap.xml');
    expect(failed.status()).toBe(503);
    expect(failed.headers()['cache-control']).toBe('no-store');
    expect(await failed.text()).toContain('站点地图暂时不可用');
  } finally {
    await keeper.query('ROLLBACK');
    keeper.release();
    await database.close();
  }
  expect((await xml(page, await page.request.get('/sitemap.xml'))).urls).toHaveLength(2);
});
test('隐藏后新请求不再返回详情元数据、站点地图或素材，草稿也不进入公开索引', async ({ page }) => {
  const privateResponse = await page.request.get('/personas/' + draftId, {
    headers: { 'user-agent': 'Twitterbot' },
  });
  expect((await page.request.get('/api/v1/personas/' + draftId)).status()).toBe(404);
  const privateHtml = await privateResponse.text();
  await mkdir('data/tests/seo', { recursive: true });
  await writeFile('data/tests/seo/private-' + test.info().project.name + '.html', privateHtml);
  await writeFile(
    'data/tests/seo/private-' + test.info().project.name + '.json',
    JSON.stringify(
      {
        status: privateResponse.status(),
        contentType: privateResponse.headers()['content-type'],
        vary: privateResponse.headers()['vary'],
        cacheControl: privateResponse.headers()['cache-control'],
      },
      null,
      2,
    ),
  );
  await unavailableDocument(page, privateResponse, '未公开的SEO隔离草稿');
  const path = '/personas/' + works.maibot.id;
  const release = PublicReleaseResponseSchema.parse(
    await (await page.request.get('/api/v1/personas/' + works.maibot.id)).json(),
  ).data;
  const visibility = async (id: string, visibility: 'hidden' | 'listed') => {
    expect(
      (
        await browserWrite(author, '/api/v1/me/personas/' + id + '/visibility', {
          visibility,
          reason: '核对公开SEO边界',
        })
      ).status(),
    ).toBe(200);
  };
  try {
    await page.goto(path);
    expect((await metadata(page)).title).toContain(title);
    await visibility(works.maibot.id, 'hidden');
    for (const candidate of [path, path + '/releases/' + works.maibot.releaseId]) {
      expect((await page.request.get('/api/v1' + candidate)).status()).toBe(404);
      const response = await page.request.get(candidate, {
        headers: { 'user-agent': 'Twitterbot' },
      });
      await unavailableDocument(page, response, title);
    }
    expect((await xml(page, await page.request.get('/sitemaps/personas/1.xml'))).urls).toEqual([
      publicUrl('/personas/' + works.astrbot.id),
    ]);
    await visibility(works.astrbot.id, 'hidden');
    expect(
      (await page.request.get('/api/v1/public/assets/' + release.snapshot.coverAssetId)).status(),
    ).toBe(404);
    expect((await xml(page, await page.request.get('/sitemaps/personas/1.xml'))).urls).toEqual([]);
    expect((await xml(page, await page.request.get('/sitemap.xml'))).urls).toEqual([
      publicUrl('/sitemaps/static.xml'),
    ]);
  } finally {
    await visibility(works.maibot.id, 'listed');
    await visibility(works.astrbot.id, 'listed');
  }
});
