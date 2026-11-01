import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  CommentResponseSchema,
  InteractionSettingsResponseSchema,
  PublicCommentsResponseSchema,
} from '@personamarket/contracts';
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
      maibot: '评论设置真实生效 ' + randomUUID().slice(0, 8),
      astrbot: '评论策略参照 ' + randomUUID().slice(0, 8),
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
              reason: '结束隔离评论设置验收',
            })
          ).status(),
        ).toBe(200);
  } finally {
    await Promise.all([ownerContext?.close(), adminContext?.close()]);
  }
});

test('评论设置冲突保留全部选项，关闭后端拒绝且输入保留，自动批准和字数频率真实生效', async ({
  page,
}, info) => {
  await page.clock.install();
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  await loginCreator(page);
  const settingsPath = '/api/v1/admin/settings/community';
  const original = InteractionSettingsResponseSchema.parse(
    await (await admin.request.get(settingsPath)).json(),
  );
  const commentsPath = '/api/v1/personas/' + works.maibot.id + '/comments';
  const privateBody = '开关关闭后仍只向本人展示的待审评论';
  const created = await browserWrite(page, commentsPath, { body: privateBody }, 'POST', {
    'Idempotency-Key': randomUUID(),
  });
  expect(created.status()).toBe(200);
  const pending = CommentResponseSchema.parse(await created.json()).data;
  expect(pending.latest.status).toBe('PENDING');
  await page.goto('/personas/' + works.maibot.id + '#comments');
  const composer = page.locator('#comment-composer');
  const input = composer.getByLabel('评论内容', { exact: true });
  const retained = '暂停期间保留的输入';
  await input.fill(retained);
  try {
    await admin.goto('/admin/settings/community');
    const enabled = admin.getByRole('switch', { name: '开放新建和编辑评论', exact: true });
    const display = admin.getByRole('switch', { name: '展示已有公开评论', exact: true });
    await expect(enabled).toBeChecked();
    await enabled.click();
    await display.click();
    await admin.getByLabel('单条评论字数上限', { exact: true }).fill('80');
    await admin.getByLabel('每人每分钟提交上限', { exact: true }).fill('2');
    await admin.getByRole('combobox', { name: '评论审核策略', exact: true }).click();
    await admin.getByRole('option', { name: '关闭预审，自动批准', exact: true }).click();
    const current = await admin.request.get(settingsPath);
    const previous = InteractionSettingsResponseSchema.parse(await current.json());
    expect(
      (
        await browserWrite(
          admin,
          settingsPath,
          { ...previous.data, commentsPerMinute: 7 },
          'PATCH',
          { 'If-Match': current.headers()['etag'] ?? '' },
        )
      ).status(),
    ).toBe(200);
    const saving = admin.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === settingsPath &&
        response.request().method() === 'PATCH',
    );
    await admin.getByRole('button', { name: '保存社区设置', exact: true }).click();
    expect((await saving).status()).toBe(412);
    await expect(enabled).not.toBeChecked();
    await expect(display).not.toBeChecked();
    await expect(admin.getByLabel('单条评论字数上限', { exact: true })).toHaveValue('80');
    await expect(admin.getByLabel('每人每分钟提交上限', { exact: true })).toHaveValue('2');
    await admin.getByRole('button', { name: '读取最新社区设置', exact: true }).click();
    await expect(admin.getByText('当前选项已保留，确认后再次保存', { exact: true })).toBeVisible();
    await expect(admin.getByLabel('每人每分钟提交上限', { exact: true })).toHaveValue('2');
    await admin.getByRole('button', { name: '保存社区设置', exact: true }).click();
    await expect(admin.getByText('社区设置已保存', { exact: true })).toBeVisible();
    const saved = InteractionSettingsResponseSchema.parse(
      await (await admin.request.get(settingsPath)).json(),
    );
    expect(saved.data).toEqual({
      ...original.data,
      commentsEnabled: false,
      showExistingComments: false,
      commentReviewMode: 'off',
      commentMaxLength: 80,
      commentsPerMinute: 2,
    });
    await expect(admin.getByRole('button', { name: '验证高危操作', exact: true })).toHaveCount(0);
    const size = admin.viewportSize();
    if (!size) throw new Error('缺少浏览器视口');
    const directory = join('data/tests/comments/current', `${size.width}x${size.height}`);
    await mkdir(directory, { recursive: true });
    const screenshot = join(directory, 'community-comment-settings.png');
    await admin.evaluate(() => scrollTo(0, 0));
    expect(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await admin.screenshot({ path: screenshot, fullPage: true });
    await info.attach('community-comment-settings', { path: screenshot, contentType: 'image/png' });
    await page.clock.fastForward(31_000);
    await page.context().setOffline(true);
    await page.context().setOffline(false);
    await expect(composer.getByRole('button', { name: '提交评论', exact: true })).toBeDisabled();
    await expect(input).toHaveValue(retained);
    await expect(page.getByText('站点暂未展示历史评论', { exact: true })).toBeVisible();
    await expect(page.locator('#my-comments')).toContainText(privateBody);
    expect(
      (
        await browserWrite(page, commentsPath, { body: '直接请求仍受开关限制' }, 'POST', {
          'Idempotency-Key': randomUUID(),
        })
      ).status(),
    ).toBe(403);
    const closed = PublicCommentsResponseSchema.parse(
      await (await page.request.get(commentsPath)).json(),
    );
    expect(closed.data).toEqual([]);
    expect(closed.settings.showExistingComments).toBe(false);
    const fresh = await admin.request.get(settingsPath);
    expect(
      (
        await browserWrite(
          admin,
          settingsPath,
          { ...saved.data, commentsEnabled: true, showExistingComments: true },
          'PATCH',
          { 'If-Match': fresh.headers()['etag'] ?? '' },
        )
      ).status(),
    ).toBe(200);
    await page.clock.fastForward(31_000);
    await page.context().setOffline(true);
    await page.context().setOffline(false);
    await expect(composer.getByRole('button', { name: '提交评论', exact: true })).toBeEnabled();
    await expect(input).toHaveValue(retained);
    await input.fill('长'.repeat(81));
    await composer.getByRole('button', { name: '提交评论', exact: true }).click();
    await expect(composer.getByText('评论最多 80 字', { exact: true })).toBeVisible();
    await expect(input).toHaveValue('长'.repeat(81));
    const body = '🌟'.repeat(40) + '作品使用体验'.repeat(5);
    await input.fill(body);
    const submitting = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === commentsPath && response.request().method() === 'POST',
    );
    await composer.getByRole('button', { name: '提交评论', exact: true }).click();
    const submitted = await submitting;
    expect(submitted.status()).toBe(200);
    expect(CommentResponseSchema.parse(await submitted.json()).data.latest).toMatchObject({
      body,
      status: 'APPROVED',
    });
    await expect(composer.getByText('评论已公开', { exact: true })).toBeVisible();
    await expect(input).toHaveValue('');
    await expect(page.locator('[aria-label="评论楼层"]').filter({ hasText: body })).toBeVisible();
    expect(
      (
        await browserWrite(page, commentsPath, { body: '超过已保存的每分钟提交上限' }, 'POST', {
          'Idempotency-Key': randomUUID(),
        })
      ).status(),
    ).toBe(429);
  } finally {
    const current = await admin.request.get(settingsPath);
    expect(
      (
        await browserWrite(admin, settingsPath, original.data, 'PATCH', {
          'If-Match': current.headers()['etag'] ?? '',
        })
      ).status(),
    ).toBe(200);
  }
});
