import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { CommentResponseSchema, OwnCommentsResponseSchema } from '@personamarket/contracts';
import { browserWrite, loginCreator } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { visualPersonas } from '../fixtures/visual-personas.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });
let ownerContext: BrowserContext;
let adminContext: BrowserContext;
let owner: Page;
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
  ownerContext = await browser.newContext(options);
  adminContext = await browser.newContext(options);
  owner = await ownerContext.newPage();
  admin = await adminContext.newPage();
  await loginCreator(owner);
  await loginBrowserAdmin(admin);
  works = await visualPersonas(owner, admin, {
    titles: {
      maibot: '评论会话隔离 ' + randomUUID().slice(0, 8),
      astrbot: '评论返回导航 ' + randomUUID().slice(0, 8),
    },
  });
});
test.afterAll(async () => {
  try {
    if (works)
      for (const work of [works.maibot, works.astrbot])
        expect(
          (
            await browserWrite(owner, '/api/v1/me/personas/' + work.id + '/visibility', {
              visibility: 'hidden',
              reason: '结束隔离评论会话验收',
            })
          ).status(),
        ).toBe(200);
  } finally {
    await Promise.all([ownerContext?.close(), adminContext?.close()]);
  }
});

test('会话失效保留未提交评论，同账号重登录可继续，换号清理旧私有文本和输入', async ({
  page,
}, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  const credentials = await loginCreator(page);
  const pendingBody = '只属于原账号的待审内容 ' + randomUUID().slice(0, 8);
  const created = await browserWrite(
    page,
    '/api/v1/personas/' + works.maibot.id + '/comments',
    { body: pendingBody },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(created.status()).toBe(200);
  const row = CommentResponseSchema.parse(await created.json()).data;
  await page.goto('/personas/' + works.maibot.id + '#comments');
  await expect(page.locator('#my-comments')).toContainText(pendingBody);
  const composer = page.locator('#comment-composer');
  const input = composer.getByLabel('评论内容', { exact: true });
  const unsaved = '尚未提交的私人输入 ' + randomUUID().slice(0, 8);
  await input.fill(unsaved);
  expect((await browserWrite(page, '/api/v1/auth/logout')).status()).toBe(200);
  await composer.getByRole('button', { name: '提交评论', exact: true }).click();
  await expect(composer.getByRole('button', { name: '提交评论', exact: true })).toBeDisabled();
  await expect(composer.getByText('登录后可以发表评论，当前未提交的输入会保留')).toBeVisible();
  await expect(input).toHaveValue(unsaved);
  await expect(page.locator('#my-comments')).toHaveCount(0);
  const other = await page.context().newPage();
  try {
    await other.goto('/login');
    await other.getByLabel('用户名或邮箱').fill(credentials.username);
    await other.getByLabel('密码', { exact: true }).fill(credentials.password);
    await other.getByRole('button', { name: '登录', exact: true }).click();
    await expect(other).toHaveURL(/\/account$/);
    await page.bringToFront();
    await expect(composer.getByRole('button', { name: '提交评论', exact: true })).toBeEnabled();
    await expect(input).toHaveValue(unsaved);
    await expect(page.locator('#my-comments')).toContainText(pendingBody);
    await loginCreator(other);
    await page.bringToFront();
    await expect(input).toHaveValue('');
    await expect(
      page.locator('#my-comments').getByText('还没有你的评论', { exact: true }),
    ).toBeVisible();
    await expect(page.locator('#comments')).not.toContainText(pendingBody);
    await expect(page.locator('#comments')).not.toContainText(unsaved);
    const own = await page.request.get('/api/v1/me/comments?personaId=' + works.maibot.id);
    expect(own.status()).toBe(200);
    expect(OwnCommentsResponseSchema.parse(await own.json()).data).toEqual([]);
    expect((await page.request.get('/api/v1/me/comments/' + row.id)).status()).toBe(404);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const size = page.viewportSize();
    if (!size) throw new Error('缺少浏览器视口');
    const directory = join('data/tests/comments/current', `${size.width}x${size.height}`);
    await mkdir(directory, { recursive: true });
    const path = join(directory, 'identity-cleared.png');
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path, fullPage: true });
    await info.attach('comment-identity-cleared', { path, contentType: 'image/png' });
    await other.goto('/login');
    await other.getByLabel('用户名或邮箱').fill(credentials.username);
    await other.getByLabel('密码', { exact: true }).fill(credentials.password);
    await other.getByRole('button', { name: '登录', exact: true }).click();
    await expect(other).toHaveURL(/\/account$/);
    await page.bringToFront();
    await expect(page.locator('#my-comments')).toContainText(pendingBody);
    await expect(input).toHaveValue('');
  } finally {
    await other.close();
  }
});

test('浏览器返回前进后仍保留尚未提交的评论', async ({ page }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  await loginCreator(page);
  await page.goto('/explore');
  await page.getByRole('link').filter({ hasText: works.astrbot.title }).first().click();
  await expect(page).toHaveURL(new RegExp('/personas/' + works.astrbot.id));
  const input = page.locator('#comment-composer').getByLabel('评论内容', { exact: true });
  const body = '浏览器前进返回时保留的文字 ' + randomUUID().slice(0, 8);
  await input.fill(body);
  page.on('dialog', (dialog) => dialog.accept());
  await page.goBack();
  await expect(page).toHaveURL(/\/explore/);
  await page.goForward();
  await expect(page).toHaveURL(new RegExp('/personas/' + works.astrbot.id));
  await expect(input).toHaveValue(body);
});
