import { expect, test } from '@playwright/test';
import { loginCreator } from '../fixtures/browser-account.js';
import { fixturePng } from '../fixtures/image.js';
test.use({ trace: 'off', screenshot: 'off' });
test('推荐模型、来源许可、CodeMirror、安全 Markdown 预览与私有图片上传', async ({ page }, info) => {
  await loginCreator(page);
  await page.goto('/dashboard/personas/new');
  await page.getByLabel('人设名称', { exact: true }).fill('Markdown 素材作品');
  await page.getByRole('button', { name: '创建私有草稿', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Markdown 素材作品', exact: true, level: 1 }),
  ).toBeVisible();
  await page.getByRole('button', { name: '添加推荐模型', exact: true }).click();
  await page.getByLabel('模型 1 · 标识', { exact: true }).fill('作者自定义模型');
  await page.getByLabel('模型 1 · 备注', { exact: true }).fill('适合温和短句');
  await page.getByRole('button', { name: '转载作品', exact: true }).click();
  await page.getByLabel('原作者', { exact: true }).fill('原作者示例');
  await page.getByLabel('来源链接', { exact: true }).fill('https://example.com/source');
  await page.getByLabel('转载授权依据', { exact: true }).fill('原作者公开授权，保留署名');
  await page
    .getByRole('checkbox', {
      name: '我确认有权提交这些内容，并授权站点按本页声明展示和提供复制下载',
      exact: true,
    })
    .check();
  await page
    .getByLabel('上传作品图片', { exact: true })
    .setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: fixturePng });
  await expect(page.getByRole('button', { name: '插入 README', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: '插入 README', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Markdown 介绍', exact: true });
  await expect(editor).toContainText('asset://');
  const existing = await editor.innerText();
  await editor.fill(
    '# 角色介绍\n\n' +
      existing +
      '\n\n<script>window.__xss=true</script>\n\n![外站](https://untrusted.fixture.invalid/tracker.png)\n\n[危险](javascript:alert(1))',
  );
  const external: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('untrusted.fixture.invalid')) external.push(request.url());
  });
  await page.getByRole('tab', { name: '实时预览', exact: true }).click();
  await expect(
    page.getByRole('tabpanel').getByRole('heading', { name: '角色介绍', exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('tabpanel', { name: '实时预览', exact: true })
      .getByText('外链图片需要先导入本站素材 · 外站', { exact: true }),
  ).toBeVisible();
  const image = page.getByRole('tabpanel').getByRole('img', { name: '图片', exact: true });
  await expect(image).toBeVisible();
  expect(
    await image.evaluate(
      (element) => element instanceof HTMLImageElement && element.naturalWidth > 0,
    ),
  ).toBe(true);
  expect(external).toEqual([]);
  expect(await page.evaluate(() => Object.prototype.hasOwnProperty.call(window, '__xss'))).toBe(
    false,
  );
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  await page
    .getByLabel('上传私有授权证据', { exact: true })
    .setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: fixturePng });
  await expect(page.getByRole('button', { name: '关联授权证据', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: '关联授权证据', exact: true }).click();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('已保存到服务器', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('metadata-and-assets.png'), fullPage: true });
  await page.reload();
  await expect(page.getByLabel('原作者', { exact: true })).toHaveValue('原作者示例');
  await expect(page.getByLabel('模型 1 · 标识', { exact: true })).toHaveValue('作者自定义模型');
});
