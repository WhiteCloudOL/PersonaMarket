import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { CommentResponseSchema } from '@personamarket/contracts';
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
  const options = {
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    ...(info.project.use.viewport ? { viewport: info.project.use.viewport } : {}),
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
  works = await visualPersonas(author, admin, {
    titles: {
      maibot: '评论公开流程 ' + randomUUID().slice(0, 8),
      astrbot: '评论版本参照 ' + randomUUID().slice(0, 8),
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
              reason: '结束隔离公开评论验收',
            })
          ).status(),
        ).toBe(200);
  } finally {
    await Promise.all([authorContext?.close(), adminContext?.close()]);
  }
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
  expect(await page.locator('#main a button, #main a a').count()).toBe(0);
  const directory = join('data/tests/comments/current', `${size.width}x${size.height}`);
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => scrollTo(0, 0));
  const path = join(directory, name + '.png');
  await page.screenshot({ path, fullPage: true });
  await page.locator('#comments').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(directory, name + '-viewport.png') });
  await info.attach(name, { path, contentType: 'image/png' });
}

test('真实创建审核回复删除，断网保留输入且不误报成功，纯文本不执行HTML', async ({
  page,
  browser,
}, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  await loginCreator(page);
  const guestContext = await browser.newContext({
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    viewport: page.viewportSize(),
  });
  const guest = await guestContext.newPage();
  try {
    const path = '/api/v1/personas/' + works.maibot.id + '/comments';
    const body =
      '真实文字安全评论 <img src=x onerror="window.__commentXss=1"> ' + randomUUID().slice(0, 8);
    await page.goto('/personas/' + works.maibot.id + '#comments');
    const composer = page.locator('#comment-composer');
    await composer.getByLabel('评论内容', { exact: true }).fill(body);
    const routePattern = '**' + path;
    await page.route(routePattern, (route) =>
      route.request().method() === 'POST' ? route.abort('failed') : route.continue(),
    );
    await composer.getByRole('button', { name: '提交评论', exact: true }).click();
    await expect(
      composer.getByText('评论服务暂时不可用，请稍后重试', { exact: true }),
    ).toBeVisible();
    await expect(composer.getByLabel('评论内容', { exact: true })).toHaveValue(body);
    await expect(composer.getByText('评论已提交，等待审核后公开', { exact: true })).toHaveCount(0);
    await page.unroute(routePattern);
    const posting = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === path && response.request().method() === 'POST',
    );
    await composer.getByRole('button', { name: '提交评论', exact: true }).click();
    const posted = await posting;
    expect(posted.status()).toBe(200);
    const row = CommentResponseSchema.parse(await posted.json()).data;
    await expect(composer.getByText('评论已提交，等待审核后公开', { exact: true })).toBeVisible();
    await expect(page.locator('#my-comments')).toContainText(body);
    await guest.goto('/personas/' + works.maibot.id + '#comments');
    await expect(guest.getByText('还没有公开评论', { exact: true })).toBeVisible();
    await expect(guest.locator('#comments')).not.toContainText(body);
    await admin.goto('/admin/comments?personaId=' + works.maibot.id + '&commentId=' + row.id);
    const review = admin.getByRole('dialog', { name: '评论审核详情', exact: true });
    await expect(review).toContainText(body);
    const approving = admin.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/admin/comments/' + row.id + '/review' &&
        response.request().method() === 'POST',
    );
    await review.getByRole('button', { name: '通过评论', exact: true }).click();
    expect((await approving).status()).toBe(200);
    await expect(review.getByRole('button', { name: '验证高危操作', exact: true })).toHaveCount(0);
    await guest.reload();
    await expect(guest.locator('[aria-label="评论楼层"]').filter({ hasText: body })).toBeVisible();
    expect(await guest.evaluate(() => Reflect.get(window, '__commentXss'))).toBeUndefined();
    expect(await guest.locator('#comments img[onerror], #comments script').count()).toBe(0);
    await page.reload();
    const root = page.locator('[aria-label="评论楼层"]').filter({ hasText: body });
    await root.getByRole('button', { name: '回复', exact: true }).click();
    const replying = page.getByRole('dialog', { name: /^回复 @/ });
    const replyBody = '保留同一个楼层的真实回复 ' + randomUUID().slice(0, 8);
    await replying.getByLabel('回复内容', { exact: true }).fill(replyBody);
    const replyPosting = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === path && response.request().method() === 'POST',
    );
    await replying.getByRole('button', { name: '提交回复', exact: true }).click();
    const replyResponse = await replyPosting;
    expect(replyResponse.status()).toBe(200);
    const reply = CommentResponseSchema.parse(await replyResponse.json()).data;
    expect(reply.parentId).toBe(row.id);
    await expect(replying).toBeHidden();
    expect(
      (
        await browserWrite(
          admin,
          '/api/v1/admin/comments/' + reply.id + '/review',
          {
            revisionId: reply.latest.id,
            expectedRevision: reply.revision,
            decision: 'approve',
            reason: '',
          },
          'POST',
          { 'Idempotency-Key': randomUUID() },
        )
      ).status(),
    ).toBe(200);
    await guest.reload();
    const guestRoot = guest.locator('[aria-label="评论楼层"]').filter({ hasText: body });
    await guestRoot.getByRole('button', { name: '查看 1 条回复', exact: true }).click();
    await expect(guest.locator('[aria-label="楼层回复"]')).toContainText(replyBody);
    await expect(guest).toHaveURL(new RegExp('replyThread=' + row.id));
    await capture(guest, info, 'published-thread');
    await page
      .locator('#my-comments article')
      .filter({ hasText: replyBody })
      .getByRole('button', { name: /^管理评论/ })
      .click();
    const own = page.getByRole('dialog', { name: '管理我的评论', exact: true });
    await own.getByRole('button', { name: '删除这条评论', exact: true }).click();
    const confirmation = page.getByRole('alertdialog', { name: '删除这条评论', exact: true });
    const removing = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/comments/' + reply.id &&
        response.request().method() === 'DELETE',
    );
    await confirmation.getByRole('button', { name: '确认删除', exact: true }).click();
    expect((await removing).status()).toBe(200);
    await expect(own).toBeHidden();
    await guest.reload();
    await expect(
      guest.locator('[aria-label="楼层回复"]').getByText('这条评论已由作者删除', { exact: true }),
    ).toBeVisible();
    await expect(guest.locator('#comments')).not.toContainText(replyBody);
    await capture(guest, info, 'deleted-reply-placeholder');
  } finally {
    await guestContext.close();
  }
});
