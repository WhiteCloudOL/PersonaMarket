import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  TransferSettingsResponseSchema,
  defaultTransferSettings,
  transferSettingsEtag,
} from '@personamarket/contracts';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { browserWrite, loginCreator } from '../fixtures/browser-account.js';
import { publishedVisualPersonas } from '../fixtures/visual-personas.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });
const path = '/api/v1/admin/settings/transfer';
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page) ?? []).toEqual([]);
});
test.afterEach(async ({ page }) => {
  const response = await page.request.get(path);
  if (response.status() !== 200) return;
  const current = TransferSettingsResponseSchema.parse(await response.json());
  if (JSON.stringify(current.data) !== JSON.stringify(defaultTransferSettings))
    expect(
      (
        await browserWrite(
          page,
          path,
          { data: defaultTransferSettings, reason: '结束隔离设置验收并恢复默认' },
          'PATCH',
          {
            'If-Match': transferSettingsEtag(current.meta.revision),
            'Idempotency-Key': randomUUID(),
          },
        )
      ).status(),
    ).toBe(200);
});

test('导入导出默认预览、收紧配置、并发合并和修改记录正常', async ({ page }) => {
  await loginBrowserAdmin(page);
  await page.goto('/admin/settings/transfer');
  await expect(
    page.getByRole('switch', { name: '允许未登录访客导出', exact: true }),
  ).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: '调整文件大小限制', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page.getByRole('button', { name: '调整文件大小限制', exact: true }).click();
  await page.getByLabel('文本和 JSON 上限（KiB）', { exact: true }).fill('512');
  await expect(page.getByText('有未保存的导入导出设置', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '预览默认设置', exact: true }).click();
  await expect(
    page.getByRole('alertdialog', { name: '预览导入导出默认设置', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '保留当前输入', exact: true }).click();
  await expect(page.getByLabel('文本和 JSON 上限（KiB）', { exact: true })).toHaveValue('512');
  await page.getByRole('button', { name: '保存导入导出设置', exact: true }).click();
  await expect(
    page.getByText('导入导出设置已保存，新请求立即使用当前配置', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '查看修改记录', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '查看修改差异', exact: true }).first(),
  ).toBeVisible();
  const original = TransferSettingsResponseSchema.parse(
    await (await page.request.get(path)).json(),
  );
  expect(
    (
      await browserWrite(
        page,
        path,
        { data: { ...original.data, guestExportsEnabled: false }, reason: '另一管理员完成修订' },
        'PATCH',
        {
          'If-Match': transferSettingsEtag(original.meta.revision),
          'Idempotency-Key': randomUUID(),
        },
      )
    ).status(),
  ).toBe(200);
  await page.getByLabel('文本和 JSON 上限（KiB）', { exact: true }).fill('256');
  await page.getByRole('button', { name: '保存导入导出设置', exact: true }).click();
  await expect(
    page.getByText('导入导出设置已保存，新请求立即使用当前配置', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('switch', { name: '允许未登录访客导出', exact: true }),
  ).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByLabel('文本和 JSON 上限（KiB）', { exact: true })).toHaveValue('256');
  await page.getByLabel('文本和 JSON 上限（KiB）', { exact: true }).fill('1024');
  await page.getByRole('button', { name: '保存导入导出设置', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(
    page.getByText('导入导出设置已保存，新请求立即使用当前配置', { exact: true }),
  ).toBeVisible();
});

test('真实公开版本按访客和格式设置展示导出，导入入口展示当前限制', async ({ page, browser }) => {
  test.setTimeout(90000);
  await loginBrowserAdmin(page);
  const origin = process.env['PLAYWRIGHT_ORIGIN'];
  if (!origin) throw Error('必须使用隔离测试站点');
  const creatorContext = await browser.newContext({ baseURL: origin }),
    guestContext = await browser.newContext({ baseURL: origin });
  try {
    const author = await creatorContext.newPage(),
      guest = await guestContext.newPage();
    await loginCreator(author);
    const works = await publishedVisualPersonas(author, page);
    const current = TransferSettingsResponseSchema.parse(
      await (await page.request.get(path)).json(),
    );
    expect(
      (
        await browserWrite(
          page,
          path,
          {
            data: {
              ...defaultTransferSettings,
              guestExportsEnabled: false,
              exportFormats: ['text'],
              importFormats: ['astrbot-json'],
              maxImportFileKiB: 512,
            },
            reason: '核对真实业务入口使用设置',
          },
          'PATCH',
          {
            'If-Match': transferSettingsEtag(current.meta.revision),
            'Idempotency-Key': randomUUID(),
          },
        )
      ).status(),
    ).toBe(200);
    await guest.goto('/personas/' + works.maibot.id);
    await guest.getByRole('button', { name: '导出', exact: true }).click();
    await expect(
      guest.getByText('本站要求登录后导出，请完成登录后重新打开此面板', { exact: true }),
    ).toBeVisible();
    await expect(guest.getByRole('button', { name: '下载文件', exact: true })).toBeDisabled();
    await author.goto('/personas/' + works.maibot.id);
    await author.getByRole('button', { name: '导出', exact: true }).click();
    await expect(author.getByRole('button', { name: '可读文本', exact: true })).toBeVisible();
    await expect(author.getByRole('button', { name: 'MaiBot TOML 片段', exact: true })).toHaveCount(
      0,
    );
    await expect(author.getByRole('button', { name: '下载文件', exact: true })).toBeEnabled();
    const downloaded = author.waitForEvent('download');
    await author.getByRole('button', { name: '下载文件', exact: true }).click();
    expect((await downloaded).suggestedFilename()).toMatch(/\.txt$/);
    await author.keyboard.press('Escape');
    await author.goto('/dashboard/personas/import');
    await expect(
      author.getByText('已启用 1 种格式 · 文本和 JSON 最大 512 KiB · ZIP 最大 128 MiB', {
        exact: true,
      }),
    ).toBeVisible();
    await author.getByRole('tab', { name: '平台原生文件', exact: true }).click();
    await expect(author.getByRole('button', { name: 'MaiBot TOML', exact: true })).toBeDisabled();
    await expect(author.getByRole('button', { name: 'AstrBot JSON', exact: true })).toBeEnabled();
  } finally {
    await creatorContext.close();
    await guestContext.close();
  }
});

test('认证缓存已就绪时完整导航多个设置页保持水合一致', async ({ page }) => {
  await loginBrowserAdmin(page);
  for (const [route, heading] of [
    ['creation', '投稿设置'],
    ['transfer', '导入导出'],
    ['home', '首页展示'],
    ['accounts', '账号设置'],
  ] as const) {
    await page.goto('/admin/settings/' + route);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: '正在校验管理员身份' })).toHaveCount(0);
    expect(pageErrors.get(page) ?? []).toEqual([]);
  }
});
