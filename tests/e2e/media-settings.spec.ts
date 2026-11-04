import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  MediaSettingsResponseSchema,
  defaultMediaSettings,
  mediaSettingsEtag,
  AssetListResponseSchema,
  DraftResponseSchema,
} from '@personamarket/contracts';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { browserWrite, loginCreator } from '../fixtures/browser-account.js';
import { fixturePng } from '../fixtures/image.js';

test.use({ trace: 'off', screenshot: 'off' });
const path = '/api/v1/admin/settings/media';
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const messages: string[] = [];
  errors.set(page, messages);
  page.on('pageerror', (error) => messages.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page) ?? []).toEqual([]);
  const response = await page.request.get(path);
  if (response.status() !== 200) return;
  const latest = MediaSettingsResponseSchema.parse(await response.json());
  if (JSON.stringify(latest.data) !== JSON.stringify(defaultMediaSettings))
    expect(
      (
        await browserWrite(
          page,
          path,
          { data: defaultMediaSettings, reason: '结束隔离图片设置验收' },
          'PATCH',
          { 'If-Match': mediaSettingsEtag(latest.meta.revision), 'Idempotency-Key': randomUUID() },
        )
      ).status(),
    ).toBe(200);
});
async function navigate(page: Page, label: string) {
  const mobile = page.getByRole('button', { name: '选择设置分组', exact: true });
  if (await mobile.isVisible()) await mobile.click();
  await page.getByRole('link', { name: label, exact: true }).click();
}

test('媒体表单按需展开，跨设置页保留输入，收紧和放宽均直接保存', async ({ page }) => {
  await loginBrowserAdmin(page);
  await page.goto('/admin/settings/media');
  await expect(page.getByRole('button', { name: '调整容量与数量', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page.getByRole('button', { name: '调整容量与数量', exact: true }).click();
  await page.getByLabel('单张原图上限（KiB）', { exact: true }).fill('256');
  page.once('dialog', (dialog) => dialog.accept());
  await navigate(page, '导入导出');
  await expect(page.getByRole('heading', { name: '导入导出', exact: true })).toBeVisible();
  await navigate(page, '文件与图片');
  await page.getByRole('button', { name: '调整容量与数量', exact: true }).click();
  await expect(page.getByLabel('单张原图上限（KiB）', { exact: true })).toHaveValue('256');
  await page.getByRole('button', { name: '保存文件与图片设置', exact: true }).click();
  await expect(
    page.getByText('文件与图片设置已保存，新请求立即使用当前配置', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('单张原图上限（KiB）', { exact: true }).fill('512');
  await page.getByRole('button', { name: '保存文件与图片设置', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.getByRole('button', { name: '查看修改记录', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '查看修改差异', exact: true }).first(),
  ).toBeVisible();
});

test('域名校验保留原输入，并发的独立预算字段同时保留', async ({ page }) => {
  await loginBrowserAdmin(page);
  await page.goto('/admin/settings/media');
  await page.getByRole('button', { name: '调整来源域限制', exact: true }).click();
  const domains = page.getByLabel('允许的图片来源域', { exact: true });
  await domains.fill('EXAMPLE.COM\n\nexample.com.');
  await page.getByRole('button', { name: '保存文件与图片设置', exact: true }).click();
  await expect(
    page.getByText('来源域不能重复，大小写、尾点与国际化域名视为同一域', { exact: true }),
  ).toBeVisible();
  const raw = 'IMAGES.EXAMPLE.COM\n\n例子.中国\n';
  await domains.fill(raw);
  const latest = MediaSettingsResponseSchema.parse(await (await page.request.get(path)).json());
  expect(
    (
      await browserWrite(
        page,
        path,
        { data: { ...latest.data, maxImagesPerAccount: 90 }, reason: '另一管理员更新图片预算' },
        'PATCH',
        { 'If-Match': mediaSettingsEtag(latest.meta.revision), 'Idempotency-Key': randomUUID() },
      )
    ).status(),
  ).toBe(200);
  await page.getByRole('button', { name: '保存文件与图片设置', exact: true }).click();
  await expect(
    page.getByText('文件与图片设置已保存，新请求立即使用当前配置', { exact: true }),
  ).toBeVisible();
  await expect(domains).toHaveValue('images.example.com\n例子.中国');
  expect(
    MediaSettingsResponseSchema.parse(await (await page.request.get(path)).json()).data
      .maxImagesPerAccount,
  ).toBe(90);
});

test('关闭上传和在线导入后入口提示当前策略，旧素材仍可引用并保存草稿', async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  await loginBrowserAdmin(page);
  const origin = process.env['PLAYWRIGHT_ORIGIN'];
  if (!origin) throw Error('缺少隔离站点');
  const context = await browser.newContext({ baseURL: origin });
  try {
    const author = await context.newPage();
    const authorErrors: string[] = [];
    author.on('pageerror', (error) => authorErrors.push(error.message));
    await loginCreator(author);
    await author.goto('/dashboard/personas/new');
    await expect(author.getByLabel('上传作品图片', { exact: true })).toBeEnabled();
    await author
      .getByLabel('上传作品图片', { exact: true })
      .setInputFiles({ name: 'owned.png', mimeType: 'image/png', buffer: fixturePng });
    await expect(author.getByRole('button', { name: '设为封面', exact: true })).toBeVisible();
    const assets = AssetListResponseSchema.parse(
      await (await author.request.get('/api/v1/me/assets')).json(),
    ).data;
    expect(assets).toHaveLength(1);
    const latest = MediaSettingsResponseSchema.parse(await (await page.request.get(path)).json());
    expect(
      (
        await browserWrite(
          page,
          path,
          {
            data: {
              ...latest.data,
              uploadsEnabled: false,
              remoteImportsEnabled: false,
              maxImageKiB: 64,
            },
            reason: '核对关闭后的真实创作入口',
          },
          'PATCH',
          { 'If-Match': mediaSettingsEtag(latest.meta.revision), 'Idempotency-Key': randomUUID() },
        )
      ).status(),
    ).toBe(200);
    await author.reload();
    await expect(author.getByLabel('上传作品图片', { exact: true })).toBeDisabled();
    await expect(author.getByRole('button', { name: '导入在线图片', exact: true })).toBeDisabled();
    await expect(
      author.getByText('单张原图最大 64 KiB · 新版本 README 最多 20 张图片', { exact: true }),
    ).toBeVisible();
    await author.getByRole('button', { name: '设为封面', exact: true }).click();
    await author.getByLabel('人设名称', { exact: true }).fill('旧素材仍可继续创作');
    await author.getByRole('button', { name: '创建私有草稿', exact: true }).click();
    await expect(author).toHaveURL(/\/dashboard\/personas\/[a-f0-9-]+\/edit$/);
    const id = author.url().split('/').at(-2);
    const stored = await author.request.get('/api/v1/me/personas/' + id + '/draft');
    expect(stored.status()).toBe(200);
    const draft = DraftResponseSchema.parse(await stored.json());
    expect(draft.data.draft.coverAssetId).toBe(assets[0]?.id);
    await author.goto('/dashboard/profile');
    await expect(author.getByLabel('资料头像', { exact: true })).toBeDisabled();
    expect(authorErrors).toEqual([]);
  } finally {
    await context.close();
  }
});
