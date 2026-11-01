import { expect, test } from '@playwright/test';
import { DraftResponseSchema } from '@personamarket/contracts';
import { loginCreator } from '../fixtures/browser-account.js';

test.use({ trace: 'off', screenshot: 'off' });
test('创建页完整填写、平台正文与来源切换保留、真实初始化和移动预览', async ({ page }, info) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await loginCreator(page);
  await page.goto('/dashboard/personas/new');
  await page.getByLabel('人设名称', { exact: true }).fill('星光书房的新角色');
  await page.getByLabel('一句话简介', { exact: true }).fill('创建时一起保存的简介');
  for (const name of ['主要分类', '作品标签']) {
    const bounds = await page.getByRole('combobox', { name, exact: true }).boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole('combobox', { name: '作品标签', exact: true }).click();
  await page.getByRole('option', { name: '温柔治愈', exact: true }).click();
  await page.getByRole('option', { name: '文学创作', exact: true }).click();
  await page.keyboard.press('Escape');
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
  expect(saved.data.draft.recommendedModels).toEqual([{ modelId: 'author/model', note: '' }]);
  expect(saved.data.draft.origin).toMatchObject({ type: 'repost', originalAuthor: '原作者说明' });
  await page.reload();
  await expect(page.getByLabel('人格设定', { exact: true })).toHaveValue(
    '  喜欢星光与阅读\n保留空白  ',
  );
});
