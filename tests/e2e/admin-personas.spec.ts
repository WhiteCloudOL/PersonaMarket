import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { AdminPersonaResponseSchema } from '@personamarket/contracts';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { loginCreator } from '../fixtures/browser-account.js';
import { visualPersonas } from '../fixtures/visual-personas.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });

test('管理员按作品筛选、查看版本并保存真实推荐标记，断网保留输入且公开页面同步展示', async ({
  page,
  browser,
}, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  const baseURL = process.env['PLAYWRIGHT_ORIGIN'];
  if (!baseURL) throw new Error('必须使用隔离测试站点');
  const context = await browser.newContext({ baseURL });
  const author = await context.newPage();
  const directory = join('data/tests/admin-personas', info.project.name, randomUUID());
  let releaseRequest = () => {};
  await mkdir(directory, { recursive: true });
  try {
    await loginBrowserAdmin(page);
    await loginCreator(author);
    const works = await visualPersonas(author, page);
    const id = works.maibot.id;
    await page.goto('/admin/personas?q=' + id);
    await page.screenshot({ path: join(directory, 'list.png'), fullPage: true });
    await expect(
      page.getByRole('heading', { level: 1, name: '人设管理', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '管理这条人设', exact: true }).click();
    const panel = page.getByRole('dialog');
    await expect(panel.getByRole('link', { name: '查看公开版本', exact: true })).toHaveAttribute(
      'href',
      '/personas/' + id,
    );
    const official = panel.getByRole('checkbox', { name: '官方作品', exact: true });
    await official.focus();
    await page.keyboard.press('Space');
    await expect(official).toBeChecked();
    const target = await official.evaluate(
      (element) => element.closest('label')?.getBoundingClientRect().height,
    );
    expect(target).toBeGreaterThanOrEqual(44);
    await panel.getByRole('checkbox', { name: '精选作品', exact: true }).check();
    const reason = '核对正文、来源和使用体验后推荐\n<img src=x onerror=alert(1)>';
    await panel.getByLabel('处理理由', { exact: true }).fill(reason);
    const endpoint = '**/api/v1/admin/personas/' + id + '/curation';
    await page.route(endpoint, (route) => route.abort('failed'));
    await panel.getByRole('button', { name: '保存标记', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('暂时');
    await expect(panel.getByLabel('处理理由', { exact: true })).toHaveValue(reason);
    await expect(official).toBeChecked();
    await page.unroute(endpoint);
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/admin/personas/' + id + '/curation') &&
        response.request().method() === 'PUT',
    );
    await panel.getByRole('button', { name: '保存标记', exact: true }).click();
    expect((await saved).status()).toBe(200);
    await expect(panel.getByRole('alert')).toContainText('人设标记已更新');
    const metadata = await page.request.get('/api/v1/admin/personas/' + id);
    expect(metadata.status()).toBe(200);
    const current = AdminPersonaResponseSchema.parse(await metadata.json()).data;
    expect(current.curation).toEqual({
      official: true,
      featured: true,
    });
    expect(await panel.locator('img[onerror]').count()).toBe(0);
    await page.screenshot({ path: join(directory, 'saved.png'), fullPage: true });
    await expect(panel.getByRole('button', { name: '关闭管理面板', exact: true })).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(panel).not.toBeVisible();
    await expect(page.getByRole('button', { name: '管理这条人设', exact: true })).toBeFocused();
    await page.goto('/personas/' + id);
    await expect(
      page.getByRole('heading', { level: 1, name: current.title, exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: join(directory, 'public.png'), fullPage: true });
    await page.screenshot({ path: join(directory, 'public-top.png') });
    const initialBadges = {
      official: await page.getByText('官方作品', { exact: true }).count(),
      featured: await page.getByText('精选作品', { exact: true }).count(),
    };
    await page.goto('/admin/personas?q=' + id);
    await page.getByRole('button', { name: '管理这条人设', exact: true }).click();
    await panel.getByRole('checkbox', { name: '精选作品', exact: true }).uncheck();
    await panel.getByLabel('处理理由', { exact: true }).fill('保留正在提交的管理操作');
    const gate = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    await page.route(endpoint, async (route) => {
      await gate;
      await route.continue();
    });
    await panel.getByRole('button', { name: '保存标记', exact: true }).click();
    await expect(panel.getByRole('button', { name: /保存标记/ })).toBeDisabled();
    await page.screenshot({ path: join(directory, 'pending.png') });
    await expect(panel.getByRole('button', { name: '关闭', exact: true })).toHaveCount(0);
    const resumed = page.waitForResponse(
      (response) =>
        response.url().endsWith('/admin/personas/' + id + '/curation') &&
        response.request().method() === 'PUT',
    );
    releaseRequest();
    expect((await resumed).status()).toBe(200);
    await page.unroute(endpoint);
    await expect(panel.getByRole('alert')).toContainText('人设标记已更新');
    await expect(panel.getByRole('button', { name: '关闭管理面板', exact: true })).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(panel).not.toBeVisible();
    await page.goto('/personas/' + id);
    expect(initialBadges).toEqual({ official: 1, featured: 1 });
    await expect(page.getByText('官方作品', { exact: true })).toBeVisible();
    await expect(page.getByText('精选作品', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    releaseRequest();
    await context.close();
  }
});
