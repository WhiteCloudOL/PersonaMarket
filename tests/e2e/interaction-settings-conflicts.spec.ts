import { expect, test, type Page } from '@playwright/test';
import { InteractionSettingsResponseSchema } from '@personamarket/contracts';
import { randomUUID } from 'node:crypto';
import { loginCreator, browserWrite } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { visualPersonas } from '../fixtures/visual-personas.js';
import { captureInteraction as capture } from '../fixtures/interaction-layout.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });

// 设置冲突使用独立文件和测试库，不与点赞、收藏、换号场景累计同一 IP 的写入额度。
test('社区开关冲突保留输入并由用户重试，关闭直接API拒绝且旧收藏可取消', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(60000);
  const contextOptions = {
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    viewport: page.viewportSize(),
    reducedMotion: 'reduce' as const,
  };
  const authorContext = await browser.newContext(contextOptions);
  const adminContext = await browser.newContext(contextOptions);
  try {
    const author = await authorContext.newPage();
    const admin = await adminContext.newPage();
    await loginCreator(author);
    await loginBrowserAdmin(admin);
    const suffix = randomUUID().slice(0, 8);
    const works = await visualPersonas(author, admin, {
      titles: { maibot: '隔离社区设置作品 ' + suffix, astrbot: '隔离社区设置对照 ' + suffix },
    });
    async function favorite(page: Page, id: string) {
      await page.goto('/personas/' + id);
      const response = page.waitForResponse(
        (item) =>
          item.url().endsWith('/api/v1/personas/' + id + '/favorite') &&
          item.request().method() === 'PUT',
      );
      await page
        .getByLabel('作品互动', { exact: true })
        .getByRole('button', { name: '收藏', exact: true })
        .click();
      expect((await response).status()).toBe(200);
      await expect(page.getByRole('button', { name: '取消收藏', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    }

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
      await expect(admin.getByText('社区设置已保存', { exact: true })).toBeVisible();
      const saved = InteractionSettingsResponseSchema.parse(
        await (await admin.request.get('/api/v1/admin/settings/community')).json(),
      );
      expect(saved.data).toEqual({
        ...previous.data,
        likesEnabled: false,
        favoritesEnabled: false,
      });
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
  } finally {
    await Promise.all([authorContext.close(), adminContext.close()]);
  }
});
