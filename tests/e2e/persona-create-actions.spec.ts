import { expect, test } from '@playwright/test';
import {
  DraftResponseSchema,
  MyPersonasResponseSchema,
  SubmissionListResponseSchema,
} from '@personamarket/contracts';
import { loginCreator } from '../fixtures/browser-account.js';
import { fixturePng } from '../fixtures/image.js';

test.use({ trace: 'off', screenshot: 'off' });

test('创建失败保留输入和已上传封面，手动重试仅创建一份私有草稿', async ({ page }) => {
  await loginCreator(page);
  await page.goto('/dashboard/personas/new');
  await page.getByLabel('人设名称', { exact: true }).fill('失败后保留的星光');
  await page.getByLabel('一句话简介', { exact: true }).fill('网络恢复后继续创作');
  await page.getByLabel('上传作品图片', { exact: true }).setInputFiles({
    name: 'cover.png',
    mimeType: 'image/png',
    buffer: fixturePng,
  });
  await page.getByRole('button', { name: '设为封面', exact: true }).click();
  await page.route('**/api/v1/me/personas', async (route) => {
    if (route.request().method() === 'POST') await route.abort('failed');
    else await route.continue();
  });
  await page.getByRole('button', { name: '创建私有草稿', exact: true }).click();
  await expect(page.getByText('请再试一次', { exact: true })).toBeVisible();
  await expect(page.getByLabel('人设名称', { exact: true })).toHaveValue('失败后保留的星光');
  await expect(page.getByLabel('一句话简介', { exact: true })).toHaveValue('网络恢复后继续创作');
  const before = MyPersonasResponseSchema.parse(
    await (await page.request.get('/api/v1/me/personas')).json(),
  );
  expect(before.meta.total).toBe(0);
  await page.unroute('**/api/v1/me/personas');
  await page.getByRole('button', { name: '创建私有草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/personas\/[a-f0-9-]+\/edit$/);
  const id = new URL(page.url()).pathname.split('/').at(-2);
  const saved = DraftResponseSchema.parse(
    await (await page.request.get(`/api/v1/me/personas/${id}/draft`)).json(),
  );
  expect(saved.data.draft.coverAssetId).toBeTruthy();
  expect(saved.data.draft.summary).toBe('网络恢复后继续创作');
  const after = MyPersonasResponseSchema.parse(
    await (await page.request.get('/api/v1/me/personas')).json(),
  );
  expect(after.meta.total).toBe(1);
  expect((await page.request.get(`/api/v1/personas/${id}`)).status()).toBe(404);
});

test('创建版本先保存完整草稿并等待人工确认，提交后仍需审核', async ({ page }) => {
  await loginCreator(page);
  await page.goto('/dashboard/personas/new');
  await page.getByLabel('人设名称', { exact: true }).fill('书房里的星光');
  await page.getByLabel('一句话简介', { exact: true }).fill('一起阅读与创作');
  await page.getByRole('button', { name: 'AstrBot', exact: true }).click();
  await page.getByLabel('人格设定', { exact: true }).fill('  温柔且尊重边界的图书管理员  ');
  await page
    .getByRole('checkbox', {
      name: '我确认有权提交这些内容，并授权站点按本页声明展示和提供复制下载',
      exact: true,
    })
    .check();
  await page.getByRole('button', { name: '创建版本', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '确认本次发版', exact: true });
  await expect(confirmation).toBeVisible();
  const id = new URL(page.url()).pathname.split('/').at(-2);
  const saved = DraftResponseSchema.parse(
    await (await page.request.get(`/api/v1/me/personas/${id}/draft`)).json(),
  );
  expect(saved.data.draft.platform).toBe('astrbot');
  expect(saved.data.draft.content).toEqual({
    systemPrompt: '  温柔且尊重边界的图书管理员  ',
    dialoguePairs: [],
  });
  const before = SubmissionListResponseSchema.parse(
    await (await page.request.get(`/api/v1/me/personas/${id}/releases`)).json(),
  );
  expect(before.data).toEqual([]);
  await confirmation.getByLabel('版本号', { exact: true }).fill('1.0.0');
  await confirmation.getByLabel('更新日志', { exact: true }).fill('第一次分享书房里的星光');
  await confirmation
    .getByRole('checkbox', {
      name: '我已核对公开内容、版本号及来源许可，确认提交审核',
      exact: true,
    })
    .check();
  await confirmation.getByRole('button', { name: '确认提交审核', exact: true }).click();
  await expect(confirmation).toBeHidden();
  const submitted = SubmissionListResponseSchema.parse(
    await (await page.request.get(`/api/v1/me/personas/${id}/releases`)).json(),
  );
  expect(submitted.data).toHaveLength(1);
  expect(submitted.data[0]?.status).toBe('PENDING');
  expect((await page.request.get(`/api/v1/personas/${id}`)).status()).toBe(404);
});

test('内容检查定位输入，未登录与未完善表单不会创建版本或清空输入', async ({ page }, info) => {
  await page.goto('/dashboard/personas/new');
  await page.getByLabel('一句话简介', { exact: true }).fill('尚未保存的灵感');
  if (info.project.name !== 'desktop')
    await page.getByRole('button', { name: '预览', exact: true }).click();
  await page.getByRole('button', { name: '查看全部检查', exact: true }).click();
  await page.getByRole('button', { name: '作品名称与简介 去完善', exact: true }).click();
  await expect(page.getByLabel('人设名称', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: '创建版本', exact: true }).click();
  await expect(
    page.getByText('请先完善内容检查中的必填项，也可以先创建私有草稿', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('一句话简介', { exact: true })).toHaveValue('尚未保存的灵感');
  await expect(page).toHaveURL(/\/dashboard\/personas\/new$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
