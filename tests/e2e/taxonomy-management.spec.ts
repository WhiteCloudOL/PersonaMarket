import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  TaxonomyManagementDetailResponseSchema,
  taxonomyEntryEtag,
} from '@personamarket/contracts';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { browserWrite } from '../fixtures/browser-account.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });
for (const kind of ['category', 'tag'] as const) {
  const plural = kind === 'category' ? 'categories' : 'tags';
  const label = kind === 'category' ? '分类' : '标签';
  test(label + '管理保留断网和冲突输入，经确认归档恢复并展示真实记录', async ({ page }, info) => {
    if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
    await loginBrowserAdmin(page);
    const directory = join('data/tests/taxonomy-management', info.project.name, kind, randomUUID());
    await mkdir(directory, { recursive: true });
    await page.goto('/admin/' + plural);
    await page.screenshot({ path: join(directory, 'list.png'), fullPage: true });
    await expect(
      page.getByRole('heading', { level: 1, name: label + '管理', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '新建' + label, exact: true }).click();
    const panel = page.getByRole('dialog', { name: '管理' + label, exact: true });
    const name = '真实创作目录-' + randomUUID().slice(0, 8);
    await panel.getByLabel('名称', { exact: true }).fill(name);
    await panel.getByLabel('处理理由', { exact: true }).fill('首次配置，网络失败时仍需保留');
    const endpoint = '**/api/v1/admin/' + plural;
    await page.route(endpoint, (route) =>
      route.request().method() === 'POST' ? route.abort('failed') : route.continue(),
    );
    await panel.getByRole('button', { name: '创建条目', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('暂时');
    await expect(panel.getByLabel('名称', { exact: true })).toHaveValue(name);
    await page.unroute(endpoint);
    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith('/admin/' + plural) && response.request().method() === 'POST',
    );
    await panel.getByRole('button', { name: '创建条目', exact: true }).click();
    const response = await created;
    expect(response.status()).toBe(200);
    const row = TaxonomyManagementDetailResponseSchema.parse(await response.json()).data;
    await expect(panel).not.toBeVisible();
    await page.getByLabel('搜索名称或 ID', { exact: true }).fill(row.id);
    await page.getByRole('button', { name: '筛选目录', exact: true }).click();
    await page.waitForURL((url) => url.searchParams.get('q') === row.id);
    await expect(page.getByRole('button', { name: '管理条目', exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: '管理条目', exact: true }).click();
    await panel.getByLabel('名称', { exact: true }).fill('核对后的真实名称');
    const reason = '核对名称后保存\n<img src=x onerror=alert(1)>';
    await panel.getByLabel('处理理由', { exact: true }).fill(reason);
    const concurrent = await browserWrite(
      page,
      '/api/v1/admin/' + plural + '/' + row.id,
      { name, active: true, sortOrder: 12, reason: '另一份管理操作先调整排序' },
      'PATCH',
      {
        'If-Match': taxonomyEntryEtag(kind, row.id, row.revision),
        'Idempotency-Key': randomUUID(),
      },
    );
    expect(concurrent.status()).toBe(200);
    const conflict = page.waitForResponse(
      (value) =>
        value.url().endsWith('/admin/' + plural + '/' + row.id) &&
        value.request().method() === 'PATCH',
    );
    await panel.getByRole('button', { name: '保存调整', exact: true }).click();
    expect((await conflict).status()).toBe(412);
    await expect(panel.getByLabel('处理理由', { exact: true })).toHaveValue(reason);
    await panel.getByRole('button', { name: '核对最新目录', exact: true }).click();
    await panel.getByRole('button', { name: '采用最新修订继续核对', exact: true }).click();
    await expect(panel.getByLabel('名称', { exact: true })).toHaveValue('核对后的真实名称');
    const saved = page.waitForResponse(
      (value) =>
        value.url().endsWith('/admin/' + plural + '/' + row.id) &&
        value.request().method() === 'PATCH',
    );
    await panel.getByRole('button', { name: '保存调整', exact: true }).click();
    expect((await saved).status()).toBe(200);
    await expect(panel).not.toBeVisible();
    await page.getByRole('button', { name: '管理条目', exact: true }).click();
    await panel.getByLabel('处理理由', { exact: true }).fill('归档没有草稿或版本引用的条目');
    await panel.getByRole('button', { name: '归档条目', exact: true }).click();
    const confirmation = page.getByRole('alertdialog');
    await expect(
      confirmation.getByRole('heading', { name: '确认归档条目', exact: true }),
    ).toBeVisible();
    const archived = page.waitForResponse(
      (value) =>
        value.url().endsWith('/admin/' + plural + '/' + row.id) &&
        value.request().method() === 'DELETE',
    );
    await confirmation.getByRole('button', { name: '确认处理', exact: true }).click();
    expect((await archived).status()).toBe(200);
    await expect(panel).not.toBeVisible();
    await page.getByRole('button', { name: '管理条目', exact: true }).click();
    await expect(panel.getByLabel('名称', { exact: true })).toBeDisabled();
    await panel.getByLabel('处理理由', { exact: true }).fill('恢复后再决定是否启用');
    await panel.getByRole('button', { name: '恢复条目', exact: true }).click();
    await expect(
      confirmation.getByRole('heading', { name: '确认恢复条目', exact: true }),
    ).toBeVisible();
    const restored = page.waitForResponse(
      (value) =>
        value.url().endsWith('/admin/' + plural + '/' + row.id + '/restore') &&
        value.request().method() === 'POST',
    );
    await confirmation.getByRole('button', { name: '确认处理', exact: true }).click();
    expect((await restored).status()).toBe(200);
    await expect(panel).not.toBeVisible();
    await page.getByRole('button', { name: '管理条目', exact: true }).click();
    await expect(panel.getByRole('checkbox', { name: '启用条目', exact: true })).not.toBeChecked();
    await expect(panel.getByRole('heading', { name: '目录记录', exact: true })).toBeVisible();
    await expect(panel.getByText('恢复后再决定是否启用', { exact: true })).toBeVisible();
    expect(await panel.locator('img[onerror]').count()).toBe(0);
    await page.screenshot({ path: join(directory, 'records.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
  });
}
