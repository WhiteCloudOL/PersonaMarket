import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { TaxonomyResponseSchema } from '@personamarket/contracts';
import { loginCreator } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { visualPersonas } from '../fixtures/visual-personas.js';
import { openExploreFilters, applyExploreFilters } from '../fixtures/explore-filters.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });
test('探索页多标签AND、README搜索、时间对话与URL状态真实可用', async ({ page, browser }) => {
  test.setTimeout(90000);
  await loginCreator(page);
  const adminContext = await browser.newContext({
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
  });
  try {
    const admin = await adminContext.newPage();
    await loginBrowserAdmin(admin);
    const works = await visualPersonas(page, admin);
    const taxonomy = TaxonomyResponseSchema.parse(
      await (await page.request.get('/api/v1/site/taxonomy')).json(),
    ).data;
    const selected = taxonomy.tags.slice(0, 2),
      unused = taxonomy.tags[3];
    if (selected.length !== 2 || !unused) throw new Error('缺少真实标签配置');
    await page.goto('/explore?q=' + encodeURIComponent('春日书房'));
    const results = page.getByRole('region', { name: '人设结果' });
    await expect(results.getByRole('link').filter({ hasText: works.maibot.title })).toBeVisible();
    const original = page.url();
    const { sheet } = await openExploreFilters(page);
    const tags = page.getByRole('group', { name: '标签 / 风格选项', exact: true });
    for (const tag of selected) {
      const control = tags.getByRole('button', { name: tag.name, exact: true });
      const bounds = await control.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
      await control.click();
      expect(page.url()).toBe(original);
      await expect(page.locator('fieldset[aria-busy]')).toHaveAttribute('aria-busy', 'false');
    }
    await applyExploreFilters(page);
    await expect(page).toHaveURL(/tagIds=/);
    await expect(results.getByRole('link').filter({ hasText: works.astrbot.title })).toBeVisible();
    const shared = page.url();
    await page.reload();
    expect(page.url()).toBe(shared);
    await expect(results.getByRole('link').filter({ hasText: works.maibot.title })).toBeVisible();
    await openExploreFilters(page);
    await tags.getByRole('button', { name: unused.name, exact: true }).click();
    await applyExploreFilters(page);
    await expect(page.getByText('没有找到匹配的人设', { exact: true })).toBeVisible();
    await page.goto(shared);
    await openExploreFilters(page);
    const choose = async (label: string, option: string) => {
      const previousUrl = page.url();
      try {
        await page.getByRole('combobox', { name: label + '筛选', exact: true }).click();
      } catch (cause) {
        await mkdir('data/tests/public-search', { recursive: true });
        await page.screenshot({
          path: 'data/tests/public-search/panel-missing.png',
          fullPage: true,
        });
        await writeFile(
          'data/tests/public-search/panel-missing.json',
          JSON.stringify(
            {
              url: page.url(),
              main: await page.locator('#main').innerText(),
              controls: await page.locator('[role="combobox"]').evaluateAll((elements) =>
                elements.map((element) => ({
                  id: element.id,
                  attributes: [...element.attributes].map((attribute) => [
                    attribute.name,
                    attribute.value,
                  ]),
                  html: element.outerHTML,
                })),
              ),
              accessibility: await page.locator('#main').ariaSnapshot(),
              panelVisible: await sheet.isVisible(),
            },
            null,
            2,
          ),
        );
        throw cause;
      }
      await page.getByRole('option', { name: option, exact: true }).click();
      expect(page.url()).toBe(previousUrl);
      await expect(page.locator('fieldset[aria-busy]')).toHaveAttribute('aria-busy', 'false');
      await expect(sheet).toBeVisible();
      await expect(
        sheet.getByRole('combobox', { name: label + '筛选', exact: true }),
      ).toContainText(option);
    };
    await choose('首次发布时间', '最近7天');
    await choose('预设对话', '包含 AstrBot 对话');
    const size = page.viewportSize();
    if (!size) throw new Error('缺少浏览器视口');
    const directory = `data/tests/new-machine-design/search-after/${size.width}x${size.height}`;
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: directory + '/filters.png', fullPage: true });
    await applyExploreFilters(page);
    await expect(page).toHaveURL(/hasDialogue=true/);
    await expect(results.getByRole('link').filter({ hasText: works.maibot.title })).toHaveCount(0);
    await expect(results.getByRole('link').filter({ hasText: works.astrbot.title })).toBeVisible();
    await page.getByRole('combobox', { name: '结果排序', exact: true }).click();
    await page.getByRole('option', { name: '最近更新', exact: true }).click();
    await expect(page).toHaveURL(/sort=updated/);
    await page.reload();
    await expect(results.getByRole('link').filter({ hasText: works.astrbot.title })).toBeVisible();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('group', { name: '已选筛选', exact: true })).toContainText(
      '包含 AstrBot 对话',
    );
    await openExploreFilters(page);
    await expect(sheet.getByRole('combobox', { name: '预设对话筛选', exact: true })).toContainText(
      '包含 AstrBot 对话',
    );
    await sheet.getByRole('button', { name: '取消', exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(
      page.getByRole('searchbox', { name: '搜索人设、标签或作者', exact: true }).last(),
    ).toHaveValue('春日书房');
    await page.screenshot({ path: directory + '/results.png', fullPage: true });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
  } finally {
    await adminContext.close();
  }
});
