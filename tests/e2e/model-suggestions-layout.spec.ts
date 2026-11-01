import { selectTheme } from '../fixtures/theme.js';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { ModelSuggestionsResponseSchema, modelSuggestionsEtag } from '@personamarket/contracts';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { browserWrite, loginCreator } from '../fixtures/browser-account.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });
test('模型建议长内容在重点视口可操作，权限、下拉焦点、故障重试和保存态正确', async ({
  page,
  browser,
}, info) => {
  const baseURL = process.env['PLAYWRIGHT_ORIGIN'];
  if (!baseURL) throw new Error('必须使用隔离站点');
  const directory = join('data/tests/model-suggestions-layout', info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  const authorContext = await browser.newContext({ baseURL }),
    guestContext = await browser.newContext({ baseURL });
  const errors: string[] = [];
  let release: (() => void) | undefined;
  try {
    const author = await authorContext.newPage(),
      guest = await guestContext.newPage();
    for (const target of [page, author])
      target.on('pageerror', (error) => errors.push(error.message));
    const path = '/api/v1/admin/settings/model-suggestions';
    await guest.goto('/admin/settings/model-suggestions');
    await expect(guest.getByText('此页面需要管理员权限', { exact: true })).toBeVisible();
    expect((await guest.request.get(path)).status()).toBe(401);
    await loginCreator(author);
    await author.goto('/admin/settings/model-suggestions');
    await expect(author.getByText('此页面需要管理员权限', { exact: true })).toBeVisible();
    expect((await author.request.get(path)).status()).toBe(403);
    await loginBrowserAdmin(page);
    const current = ModelSuggestionsResponseSchema.parse(
      await (await page.request.get(path)).json(),
    );
    const modelId = 'fixture/' + '星光创作'.repeat(35);
    const response = await browserWrite(
      page,
      path,
      {
        data: {
          entries: [
            {
              id: randomUUID(),
              modelId,
              note: 'https://example.invalid/' + 'long-model-note-'.repeat(20),
              enabled: true,
            },
            {
              id: randomUUID(),
              modelId: 'fixture/disabled-private',
              note: '停用说明',
              enabled: false,
            },
          ],
        },
        reason: '重点视口与长模型名验证',
      },
      'PATCH',
      { 'If-Match': modelSuggestionsEtag(current.meta.revision), 'Idempotency-Key': randomUUID() },
    );
    expect(response.status()).toBe(200);
    await page.goto('/admin/settings/model-suggestions');
    await expect(page.getByLabel('建议 1 · 模型标识', { exact: true })).toHaveValue(modelId);
    await author.goto('/dashboard/personas/new');
    const combo = author.getByRole('combobox', { name: '站点模型建议', exact: true });
    await expect(combo).toBeEnabled();
    const sizes =
      info.project.name === 'desktop'
        ? [
            [1366, 768],
            [1440, 900],
            [1920, 1080],
          ]
        : info.project.name === 'mobile'
          ? [
              [360, 800],
              [390, 844],
              [430, 932],
            ]
          : [
              [768, 1024],
              [960, 800],
              [1024, 768],
            ];
    const measurements = [];
    for (const [width = 390, height = 844] of sizes) {
      for (const target of [page, author]) {
        await target.setViewportSize({ width, height });
        await target.evaluate(() => document.fonts.ready);
      }
      await page
        .getByRole('heading', { level: 1, name: '模型建议', exact: true })
        .scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: join(directory, width + 'x' + height + '-settings.png') });
      await combo.click();
      const option = author.getByRole('option', { name: modelId, exact: true });
      await expect(option).toBeVisible();
      expect(
        await option.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
      expect(await author.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const bounds = await combo.boundingBox(),
        optionBounds = await option.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
      expect(optionBounds?.height).toBeGreaterThanOrEqual(44);
      await author.screenshot({ path: join(directory, width + 'x' + height + '-suggestions.png') });
      await author.keyboard.press('Escape');
      await expect(combo).toBeFocused();
      measurements.push({
        width,
        height,
        overflow: false,
        targetHeight: bounds?.height,
        optionHeight: optionBounds?.height,
      });
    }
    const viewport =
      info.project.name === 'desktop'
        ? { width: 1440, height: 900 }
        : info.project.name === 'mobile'
          ? { width: 390, height: 844 }
          : { width: 768, height: 1024 };
    for (const target of [page, author]) {
      await target.setViewportSize(viewport);
      await selectTheme(target, 'dark');
      await target.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      expect(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await page.getByRole('button', { name: '预览默认设置', exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(
      dialog.getByRole('heading', { name: '核对模型建议默认设置', exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole('button', { name: '保留当前输入', exact: true })).toBeInViewport({
      ratio: 1,
    });
    await expect(dialog.getByRole('button', { name: '填入默认值', exact: true })).toBeInViewport({
      ratio: 1,
    });
    await page.screenshot({ path: join(directory, 'dark-large-defaults.png') });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '预览默认设置', exact: true })).toBeFocused();
    await combo.click();
    await expect(author.getByRole('option', { name: modelId, exact: true })).toBeVisible();
    await author.screenshot({ path: join(directory, 'dark-large-suggestions.png') });
    await author.keyboard.press('ArrowDown');
    await author.keyboard.press('Enter');
    await expect(author.getByLabel('模型 1 · 标识', { exact: true })).toHaveValue(modelId);
    await author.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
    await author.route('**/api/v1/site/model-suggestions', (route) => route.abort('failed'));
    author.once('dialog', (dialog) => dialog.accept());
    await author.reload();
    await expect(
      author.getByText('模型建议暂时无法读取，你仍可自由填写', { exact: true }),
    ).toBeVisible();
    await author.getByRole('button', { name: '添加推荐模型', exact: true }).click();
    await author.getByLabel('模型 1 · 标识', { exact: true }).fill('author/网络失败时仍可填写');
    await author.unroute('**/api/v1/site/model-suggestions');
    await author.getByRole('button', { name: '重试模型建议', exact: true }).click();
    await expect(combo).toBeVisible();
    await expect(author.getByLabel('模型 1 · 标识', { exact: true })).toHaveValue(
      'author/网络失败时仍可填写',
    );
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
    await page.getByLabel('建议 1 · 备注', { exact: true }).fill('保存中检查全部控件');
    await page.getByLabel('处理理由', { exact: true }).fill('软键盘可用区域与保存状态检查');
    await page.setViewportSize({ width: 390, height: 480 });
    const input = page.getByLabel('处理理由', { exact: true });
    await input.focus();
    await input.scrollIntoViewIfNeeded();
    const fieldBounds = await input.boundingBox(),
      barBounds = await page
        .getByRole('group', { name: '模型建议保存操作', exact: true })
        .boundingBox();
    expect(fieldBounds && barBounds && fieldBounds.y + fieldBounds.height <= barBounds.y).toBe(
      true,
    );
    await page.screenshot({ path: join(directory, 'limited-height-input.png') });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**' + path, async (route) => {
      if (route.request().method() === 'PATCH') await pending;
      await route.continue();
    });
    const saved = page.waitForResponse(
      (response) => response.url().endsWith(path) && response.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: '保存模型建议', exact: true }).click();
    await expect(page.getByRole('button', { name: '正在保存…', exact: true })).toBeDisabled();
    await expect(page.getByLabel('建议 1 · 模型标识', { exact: true })).toBeDisabled();
    if (!release) throw new Error('保存请求的受控等待尚未建立');
    release();
    release = undefined;
    expect((await saved).status()).toBe(200);
    expect(errors).toEqual([]);
    await writeFile(
      join(directory, 'measurements.json'),
      JSON.stringify(
        {
          measurements,
          scope:
            'Chromium emulation, 200% root font, reduced available height; no physical phone or system keyboard',
        },
        null,
        2,
      ),
    );
  } finally {
    release?.();
    await authorContext.close();
    await guestContext.close();
  }
});
