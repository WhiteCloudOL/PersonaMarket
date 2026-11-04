import { expect, test } from '@playwright/test';
import { loginCreator } from '../fixtures/browser-account.js';
import { fixturePng } from '../fixtures/image.js';
test.use({ trace: 'off', screenshot: 'off' });
test('推荐模型、来源许可、CodeMirror、安全 Markdown 预览与私有图片上传', async ({ page }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
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
  const editor = page.getByRole('textbox', { name: 'Markdown 介绍', exact: true });
  await editor.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('readme-editor.png') });
  await expect(page.getByRole('heading', { name: '素材库', exact: true })).toHaveCount(0);
  await editor.fill('角色介绍');
  await page.getByRole('button', { name: '二级标题', exact: true }).click();
  await expect(editor).toHaveText('## 角色介绍');
  await editor.press('End');
  await editor.press('Enter');
  await editor.press('Enter');
  await page.getByRole('button', { name: '加粗', exact: true }).click();
  await editor.press('S');
  await expect(editor).toContainText('**S**');
  await editor.fill('## 角色介绍\n\n末尾说明');
  await editor.press('Control+Home');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '上传图片', exact: true }).click();
  await (await chooser).setFiles({ name: 'sample.png', mimeType: 'image/png', buffer: fixturePng });
  await expect(editor).toHaveText(/!\[图片\]\(asset:\/\/[a-f0-9-]+\).*## 角色介绍/s);
  await page.getByRole('group', { name: 'Markdown 格式', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('readme-toolbar.png') });
  if (info.project.name === 'mobile') {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: info.outputPath('readme-toolbar-dark.png') });
    await page.emulateMedia({ colorScheme: 'light' });
  }
  await page.getByRole('tab', { name: '实时预览', exact: true }).click();
  await expect(
    page.getByRole('tabpanel').getByRole('img', { name: '图片', exact: true }),
  ).toBeVisible();
  await page.getByRole('tab', { name: '编辑介绍', exact: true }).click();
  await editor.press('ControlOrMeta+z');
  await expect(editor).not.toContainText('asset://');
  await expect(editor).toHaveText(/## 角色介绍.*末尾说明/s);
  await editor.press('ControlOrMeta+y');
  await expect(editor).toContainText('asset://');
  await editor.press('Control+End');
  await editor.evaluate((element, png) => {
    const transfer = new DataTransfer();
    const bytes = Uint8Array.from(atob(png), (character) => character.charCodeAt(0));
    transfer.items.add(new File([bytes], 'paste.png', { type: 'image/png' }));
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, fixturePng.toString('base64'));
  await expect(editor).toHaveText(/asset:\/\/.*末尾说明.*asset:\/\//s);
  await editor.press('ControlOrMeta+z');
  await expect(editor).toHaveText(/末尾说明$/);
  await page.getByRole('button', { name: '在线图片', exact: true }).click();
  const address = page.getByLabel('在线图片地址', { exact: true });
  await address.fill('https://127.0.0.1/test.png');
  await page.getByRole('button', { name: '导入在线图片', exact: true }).click();
  await expect(
    page.getByText('图片地址不可访问，请使用公网 HTTPS 静态图片', { exact: true }),
  ).toBeVisible();
  await expect(address).toHaveValue('https://127.0.0.1/test.png');
  await page.getByRole('button', { name: '在线图片', exact: true }).click();
  const existing = await editor.innerText();
  await editor.fill(
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
  await expect(page.getByRole('button', { name: '移除证据 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('已保存到服务器', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('metadata-and-assets.png'), fullPage: true });
  await page.reload();
  await expect(page.getByLabel('原作者', { exact: true })).toHaveValue('原作者示例');
  await expect(page.getByLabel('模型 1 · 标识', { exact: true })).toHaveValue('作者自定义模型');
});
