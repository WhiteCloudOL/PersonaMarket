import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { z } from 'zod';
import { createDatabase } from '@personamarket/database';
import {
  GuideFieldsSchema,
  GuideSlugSchema,
  AdminGuideResponseSchema,
  guideEtag,
} from '@personamarket/contracts';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { browserWrite } from '../fixtures/browser-account.js';

test.use({ trace: 'off', screenshot: 'off' });

test('真实数据库锁超时显示读取失败，释放后重新加载恢复公开章节', async ({ page }) => {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test'))
    throw new Error('必须使用隔离指南测试库');
  const db = createDatabase(source),
    connection = await db.pool.connect();
  let transaction = false;
  try {
    await connection.query('BEGIN');
    transaction = true;
    await connection.query("SET LOCAL lock_timeout='1s'");
    await connection.query('LOCK TABLE guide_entries IN ACCESS EXCLUSIVE MODE');
    expect((await page.request.get('/api/v1/site/guides')).status()).toBe(503);
    await page.goto('/guides');
    await expect(page.getByText('指南暂时无法读取，可以重新加载', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('link', { name: '在 GitHub 查看项目源码', exact: true }),
    ).toHaveAttribute('href', 'https://github.com/WhiteCloudOL/PersonaMarket');
    await expect(page.locator('[data-guide-body]')).toHaveCount(0);
    await connection.query('COMMIT');
    transaction = false;
    await page.getByRole('button', { name: '重新加载', exact: true }).click();
    await expect(page.locator('[data-guide-body="getting-started"]')).toBeVisible();
    await expect(page.getByText('指南暂时无法读取，可以重新加载', { exact: true })).toHaveCount(0);
  } finally {
    try {
      if (transaction) await connection.query('ROLLBACK');
    } finally {
      connection.release();
      await db.close();
    }
  }
});
test('九章指南保留原全文和锚点，编辑稿隔离，发布撤回同时影响正文、独立页面和站点地图', async ({
  page,
}) => {
  const originals = z
    .array(GuideFieldsSchema.extend({ slug: GuideSlugSchema, originalText: z.string() }))
    .parse(
      JSON.parse(
        await readFile(new URL('../fixtures/guides-initial.json', import.meta.url), 'utf8'),
      ),
    );
  await page.goto('/guides');
  for (const original of originals) {
    const body = page.locator('[data-guide-body="' + original.slug + '"]');
    await expect(body).toBeVisible();
    expect((await body.textContent())?.replace(/\s+/gu, '')).toBe(
      original.originalText.replace(/\s+/gu, ''),
    );
    expect(await body.locator('code').allTextContents()).toEqual(
      Array.from(original.bodyMarkdown.matchAll(/`([^`]+)`/gu), (match) => match[1]),
    );
    await expect(page.locator('h2#' + original.slug)).toHaveText(original.title);
  }
  await page.goto('/guides/maibot');
  await expect(
    page.getByRole('heading', { level: 1, name: 'MaiBot 使用方式', exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-guide-body="maibot"]')).toContainText('1.3.15');
  await loginBrowserAdmin(page);
  const path = '/api/v1/admin/guides/maibot';
  const initial = AdminGuideResponseSchema.parse(await (await page.request.get(path)).json());
  const fields = {
    title: '独立发布的新指南',
    summary: '新的公开阅读说明',
    bodyMarkdown: '## 新的步骤\n\n明确发布后才公开这段文字',
  };
  const saved = await browserWrite(
    page,
    path,
    { ...fields, reason: '核对公开与编辑稿隔离' },
    'PATCH',
    { 'If-Match': guideEtag('maibot', initial.data.revision), 'Idempotency-Key': randomUUID() },
  );
  expect(saved.status()).toBe(200);
  const edited = AdminGuideResponseSchema.parse(await saved.json());
  await page.goto('/guides/maibot');
  await expect(
    page.getByRole('heading', { level: 1, name: 'MaiBot 使用方式', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(fields.title, { exact: true })).toHaveCount(0);
  const published = await browserWrite(
    page,
    path + '/actions/publish',
    { reason: '确认公开新指南', confirmed: true },
    'POST',
    { 'If-Match': guideEtag('maibot', edited.data.revision), 'Idempotency-Key': randomUUID() },
  );
  expect(published.status()).toBe(200);
  const current = AdminGuideResponseSchema.parse(await published.json());
  await page.reload();
  await expect(
    page.getByRole('heading', { level: 1, name: fields.title, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.locator('[data-guide-body="maibot"]')).toContainText(
    '明确发布后才公开这段文字',
  );
  await page.goto('/guides');
  await expect(page.locator('h2#maibot')).toHaveText(fields.title);
  const hidden = await browserWrite(
    page,
    path + '/actions/withdraw',
    { reason: '核对撤回和索引边界', confirmed: true },
    'POST',
    { 'If-Match': guideEtag('maibot', current.data.revision), 'Idempotency-Key': randomUUID() },
  );
  expect(hidden.status()).toBe(200);
  expect((await page.request.get('/api/v1/site/guides/maibot')).status()).toBe(404);
  await page.reload();
  await expect(page.locator('[data-guide-body="maibot"]')).toHaveCount(0);
  const response = await page.request.get('/guides/maibot');
  const html = await response.text();
  expect([200, 404]).toContain(response.status());
  expect(html).toContain('noindex');
  expect(html).not.toContain(fields.title);
  expect(html).not.toContain('明确发布后才公开这段文字');
  const sitemap = await page.request.get('/sitemaps/static.xml');
  expect(sitemap.status()).toBe(200);
  expect(await sitemap.text()).not.toContain('/guides/maibot');
});

test('指南原始HTML对浏览器和社交爬虫提供公开metadata，编辑稿不改变索引，撤回为noindex且不泄漏正文', async ({
  page,
}, info) => {
  const directory = join('data/tests/guides-seo', info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  await loginBrowserAdmin(page);
  const endpoint = '/api/v1/admin/guides/astrbot',
    path = '/guides/astrbot';
  const initial = AdminGuideResponseSchema.parse(
    await (await page.request.get(endpoint)).json(),
  ).data;
  const title = '公开指南 <星光> & "规范"',
    body = 'GUIDE_PUBLIC_BODY_' + randomUUID();
  async function action(revision: number, kind: 'publish' | 'withdraw') {
    const response = await browserWrite(
      page,
      endpoint + '/actions/' + kind,
      { reason: '核对指南原始响应和索引边界', confirmed: true },
      'POST',
      { 'If-Match': guideEtag('astrbot', revision), 'Idempotency-Key': randomUUID() },
    );
    expect(response.status()).toBe(200);
    return AdminGuideResponseSchema.parse(await response.json()).data;
  }
  const edit = await browserWrite(
    page,
    endpoint,
    {
      title,
      summary: '用于社交分享的真实摘要 <安全> & 星光',
      bodyMarkdown: '# 正文里的标题\n\n' + body,
      reason: '准备真实公开指南内容',
    },
    'PATCH',
    { 'If-Match': guideEtag('astrbot', initial.revision), 'Idempotency-Key': randomUUID() },
  );
  expect(edit.status()).toBe(200);
  const published = await action(
    AdminGuideResponseSchema.parse(await edit.json()).data.revision,
    'publish',
  );
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  const sitemapBefore = await page.request.get('/sitemaps/static.xml');
  expect(sitemapBefore.status()).toBe(200);
  const sitemap = await sitemapBefore.text();
  expect(sitemap).toContain(new URL(path, process.env['PUBLIC_ORIGIN']).href);
  const secret = 'GUIDE_PRIVATE_NEVER_PUBLIC_' + randomUUID();
  const privateEdit = await browserWrite(
    page,
    endpoint,
    {
      title: '尚未发布的指南标题',
      summary: secret,
      bodyMarkdown: secret,
      reason: '保存后验证公开快照不变',
    },
    'PATCH',
    { 'If-Match': guideEtag('astrbot', published.revision), 'Idempotency-Key': randomUUID() },
  );
  expect(privateEdit.status()).toBe(200);
  const edited = AdminGuideResponseSchema.parse(await privateEdit.json()).data;
  expect(await (await page.request.get('/sitemaps/static.xml')).text()).toBe(sitemap);
  for (const agent of ['Mozilla/5.0', 'Twitterbot/1.0']) {
    const response = await page.request.get(path, { headers: { 'User-Agent': agent } });
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-store');
    const source = await response.text();
    await writeFile(
      join(directory, agent.startsWith('Twitter') ? 'crawler.html' : 'browser.html'),
      source,
    );
    expect(source).not.toContain(secret);
    expect(source).not.toContain('尚未发布的指南标题');
    expect(source).toContain(body);
    const metadata = await page.evaluate((source) => {
      const doc = new DOMParser().parseFromString(source, 'text/html');
      return {
        title: doc.title,
        canonical: [...doc.querySelectorAll('link[rel="canonical"]')].map((e) =>
          e.getAttribute('href'),
        ),
        ogTitle: doc.querySelector('meta[property="og:title"]')?.getAttribute('content'),
        ogUrl: doc.querySelector('meta[property="og:url"]')?.getAttribute('content'),
        description: doc.querySelector('meta[name="description"]')?.getAttribute('content'),
        twitter: doc.querySelector('meta[name="twitter:card"]')?.getAttribute('content'),
        headCanonical: doc.head.querySelector('link[rel="canonical"]')?.getAttribute('href'),
        robots: [...doc.querySelectorAll('meta[name="robots"]')].flatMap(
          (e) =>
            e
              .getAttribute('content')
              ?.split(',')
              .map((s) => s.trim()) ?? [],
        ),
      };
    }, source);
    expect(metadata.title).toContain(title);
    expect(metadata.ogTitle).toContain(title);
    expect(metadata.description).toBe(published.summary);
    const canonical = new URL(path, process.env['PUBLIC_ORIGIN']).href;
    expect(metadata.canonical).toEqual([canonical]);
    expect(metadata.ogUrl).toBe(canonical);
    expect(metadata.twitter).toBe('summary_large_image');
    if (agent.startsWith('Twitter')) expect(metadata.headCanonical).toBe(canonical);
    const indexed = process.env['PUBLIC_ORIGIN'] === 'https://market.example.org';
    expect(metadata.robots).toContain(indexed ? 'index' : 'noindex');
    expect(metadata.robots).not.toContain(indexed ? 'noindex' : 'index');
    await writeFile(
      join(directory, agent.startsWith('Twitter') ? 'crawler.json' : 'browser.json'),
      JSON.stringify({ status: response.status(), ...metadata }, null, 2),
    );
  }
  await action(edited.revision, 'withdraw');
  for (const agent of ['Mozilla/5.0', 'Twitterbot/1.0']) {
    const response = await page.request.get(path, { headers: { 'User-Agent': agent } });
    expect([200, 404]).toContain(response.status());
    const source = await response.text();
    await writeFile(
      join(
        directory,
        agent.startsWith('Twitter') ? 'withdrawn-crawler.html' : 'withdrawn-browser.html',
      ),
      source,
    );
    expect(source).not.toContain(title);
    expect(source).not.toContain(body);
    expect(source).not.toContain(secret);
    const robots = await page.evaluate(
      (source) =>
        [
          ...new DOMParser()
            .parseFromString(source, 'text/html')
            .querySelectorAll('meta[name="robots"]'),
        ].flatMap(
          (e) =>
            e
              .getAttribute('content')
              ?.split(',')
              .map((s) => s.trim()) ?? [],
        ),
      source,
    );
    expect(robots).toContain('noindex');
    expect(robots).not.toContain('index');
    await writeFile(
      join(
        directory,
        agent.startsWith('Twitter') ? 'withdrawn-crawler.json' : 'withdrawn-browser.json',
      ),
      JSON.stringify({ status: response.status(), robots }, null, 2),
    );
  }
  await page.goto(path);
  await expect(
    page.getByRole('heading', { level: 1, name: '这篇指南暂时无法访问', exact: true }),
  ).toBeVisible();
  expect((await page.request.get('/api/v1/site/guides/astrbot')).status()).toBe(404);
  expect(await (await page.request.get('/sitemaps/static.xml')).text()).not.toContain(path);
});
