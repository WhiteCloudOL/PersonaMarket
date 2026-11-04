import { expect, test } from '@playwright/test';
import { DraftResponseSchema } from '@personamarket/contracts';
import { loginCreator } from '../fixtures/browser-account.js';
import { fixturePng } from '../fixtures/image.js';

test.use({ trace: 'off', screenshot: 'off' });
test('创建页完整填写、平台正文与来源切换保留、真实初始化和移动预览', async ({ page }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await loginCreator(page);
  await page.goto('/dashboard/personas/new');
  await expect(page.locator('link[rel="icon"][href^="/favicon.ico"]')).toHaveCount(1);
  expect((await page.request.get('/favicon.ico')).status()).toBe(200);
  await page.getByLabel('人设名称', { exact: true }).fill('星光书房的新角色');
  await page.getByLabel('一句话简介', { exact: true }).fill('创建时一起保存的简介');
  const tag = page.getByLabel('作品标签', { exact: true });
  expect(
    (await page.getByRole('combobox', { name: '主要分类', exact: true }).boundingBox())?.height,
  ).toBeGreaterThanOrEqual(44);
  expect((await tag.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  for (const name of ['温柔治愈', '文学创作']) {
    await tag.fill(name);
    await page.getByRole('button', { name, exact: true }).click();
  }
  await tag.fill(' 星海图书馆 ');
  await tag.press('Enter');
  await expect(
    page.getByRole('button', { name: '移除标签 星海图书馆', exact: true }),
  ).toBeVisible();
  const avatarFile = { name: 'avatar.png', mimeType: 'image/png', buffer: fixturePng };
  const avatarInput = page.getByLabel('人设头像', { exact: true });
  const crop = page.getByRole('dialog', { name: '裁切头像', exact: true });
  let avatarUploads = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/me/assets/upload-persona-avatar'))
      avatarUploads++;
  });
  await avatarInput.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('create-avatar-field.png') });
  await avatarInput.setInputFiles(avatarFile);
  await expect(crop).toBeVisible();
  await expect(crop.getByRole('button', { name: '使用裁切头像' })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('create-avatar-crop.png') });
  if (info.project.name === 'mobile') {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: info.outputPath('create-avatar-crop-dark.png') });
    await page.emulateMedia({ colorScheme: 'light' });
  }
  await crop.getByRole('button', { name: '取消', exact: true }).click();
  await expect(crop).toHaveCount(0);
  await expect(avatarInput).toBeFocused();
  await expect(page.getByLabel('一句话简介', { exact: true })).toHaveValue('创建时一起保存的简介');
  expect(avatarUploads).toBe(0);
  await avatarInput.setInputFiles(avatarFile);
  await crop.getByRole('button', { name: '使用裁切头像' }).click();
  await expect(page.getByAltText('当前人设头像')).toBeVisible();
  expect(avatarUploads).toBe(1);
  await page.getByLabel('人格设定', { exact: true }).fill('  喜欢星光与阅读\n保留空白  ');
  await page.getByLabel('表达风格', { exact: true }).fill('温和自然');
  await page.getByLabel('行为风格', { exact: true }).fill('尊重边界');
  await page.getByRole('button', { name: 'AstrBot', exact: true }).click();
  await page.getByLabel('人格设定', { exact: true }).fill('AstrBot 独立保留的设定');
  await page.getByRole('button', { name: '添加一对对话', exact: true }).click();
  await page.getByLabel('对话 1 · 用户', { exact: true }).fill('你好');
  await page.getByLabel('对话 1 · AI', { exact: true }).fill('欢迎来到星光书房');
  await page.screenshot({ path: info.outputPath('before-platform-return.png'), fullPage: true });
  expect(browserErrors).toEqual([]);
  await expect(page).toHaveURL(/\/dashboard\/personas\/new$/);
  await page.getByRole('button', { name: 'MaiBot', exact: true }).click();
  await expect(page.getByLabel('人格设定', { exact: true })).toHaveValue(
    '  喜欢星光与阅读\n保留空白  ',
  );
  await page.getByRole('button', { name: '添加推荐模型', exact: true }).click();
  await page.getByLabel('模型 1 · 标识', { exact: true }).fill('author/model');
  await page.getByRole('button', { name: '转载作品', exact: true }).click();
  await page.getByLabel('原作者', { exact: true }).fill('原作者说明');
  await page.getByRole('button', { name: '原创作品', exact: true }).click();
  await page.getByRole('button', { name: '转载作品', exact: true }).click();
  await expect(page.getByLabel('原作者', { exact: true })).toHaveValue('原作者说明');
  if (info.project.name !== 'desktop') {
    await page.getByRole('button', { name: '预览', exact: true }).click();
    await expect(
      page.getByRole('dialog').getByRole('heading', { name: '星光书房的新角色', exact: true }),
    ).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  }
  await page.getByRole('button', { name: '创建私有草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/personas\/[a-f0-9-]+\/edit$/);
  const id = page.url().split('/').at(-2);
  const saved = DraftResponseSchema.parse(
    await (await page.request.get('/api/v1/me/personas/' + id + '/draft')).json(),
  );
  expect(saved.meta.revision).toBe(1);
  expect(saved.data.draft.summary).toBe('创建时一起保存的简介');
  expect(saved.data.draft.tagIds).toHaveLength(2);
  expect(saved.data.draft.customTags).toEqual(['星海图书馆']);
  expect(saved.data.draft.avatarAssetId).toBeTruthy();
  expect(
    (await page.request.get('/api/v1/me/assets/' + saved.data.draft.avatarAssetId)).headers()[
      'content-type'
    ],
  ).toContain('image/webp');
  expect(saved.data.draft.recommendedModels).toEqual([{ modelId: 'author/model', note: '' }]);
  expect(saved.data.draft.origin).toMatchObject({ type: 'repost', originalAuthor: '原作者说明' });
  await page.reload();
  await expect(page.getByAltText('当前人设头像')).toBeVisible();
  await expect(
    page.getByRole('button', { name: '移除标签 星海图书馆', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('人格设定', { exact: true })).toHaveValue(
    '  喜欢星光与阅读\n保留空白  ',
  );
  await avatarInput.setInputFiles(avatarFile);
  const position = crop.getByRole('group', { name: '头像裁切预览', exact: true });
  await position.press('End');
  await page.screenshot({ path: info.outputPath('edit-avatar-crop.png') });
  await crop.getByRole('button', { name: '使用裁切头像' }).click();
  await expect(crop).toHaveCount(0);
  await expect(page.getByAltText('当前人设头像')).not.toHaveAttribute(
    'src',
    '/api/v1/me/assets/' + saved.data.draft.avatarAssetId,
  );
  await expect(page.getByText('已保存到服务器', { exact: true })).toBeVisible();
  await page.reload();
  const editedAvatar = page.getByAltText('当前人设头像');
  await expect(editedAvatar).toBeVisible();
  await expect
    .poll(() => editedAvatar.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(1);
  expect(await editedAvatar.evaluate((image: HTMLImageElement) => image.naturalHeight)).toBe(1);
  const avatar = await page.request.get((await editedAvatar.getAttribute('src')) ?? '');
  expect(avatar.status()).toBe(200);
  expect(avatar.headers()['content-type']).toContain('image/webp');
});
