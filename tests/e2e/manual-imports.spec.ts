import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DraftResponseSchema, ImportPreviewResponseSchema } from '@personamarket/contracts';
import { loginCreator, browserWrite } from '../fixtures/browser-account.js';

test.use({ trace: 'off', screenshot: 'off' });
const sourcePath = '**/api/v1/me/persona-imports/text/source/file?*';
const previewPath = '**/api/v1/me/persona-imports/text/preview';
const mappedConfirmation = '我已逐项核对字段映射，原文中的其他内容不会导入';
const importConfirmation = '我已核对正文、忽略字段和来源，确认按上述范围导入私有草稿';

async function openImport(page: Page, info: TestInfo) {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  await loginCreator(page);
  await page.goto('/dashboard/personas/import');
  await page.getByRole('tab', { name: 'TXT / Markdown', exact: true }).click();
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('缺少测试视口');
  const directory = join('data/tests/text-mapping/current', `${viewport.width}x${viewport.height}`);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, 'text-entry.png'), fullPage: true });
  return directory;
}
async function selectEncoding(page: Page, label: string) {
  await page.getByRole('combobox', { name: '文件编码', exact: true }).click();
  await page.getByRole('option', { name: label, exact: true }).click();
}
async function screenshot(page: Page, directory: string, filename: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(directory, filename), fullPage: true });
}

test('GBK原文键盘选区保留CRLF、对话校验、失败重试和返回映射后真实保存', async ({ page }, info) => {
  const directory = await openImport(page, info);
  await page.getByRole('button', { name: 'AstrBot 人格与对话', exact: true }).click();
  const raw = Buffer.concat([
    Buffer.from('  '),
    Buffer.from([0xd6, 0xd0, 0xce, 0xc4]),
    Buffer.from('\r\nend  '),
  ]);
  await page
    .getByLabel('TXT / Markdown 文件', { exact: true })
    .setInputFiles({ name: '旧编码原文.txt', mimeType: 'text/plain', buffer: raw });
  await selectEncoding(page, 'UTF-8');
  await page.getByRole('button', { name: '读取文本原文', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '无法按 UTF-8' })).toBeVisible();
  await selectEncoding(page, '自动识别（推荐）');
  await page.getByRole('button', { name: '读取文本原文', exact: true }).click();
  const original = page.getByLabel('文本原文（只读）', { exact: true });
  await expect(original).toHaveValue('  中文\nend  ');
  await expect(page.getByRole('region', { name: '文本导入工作区', exact: true })).toBeFocused();
  await expect(page.getByRole('status').filter({ hasText: 'GB18030' })).toBeVisible();
  await original.focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.getByRole('button', { name: '选中文本填入系统提示词', exact: true }).click();
  await expect(page.getByLabel('系统提示词', { exact: true })).toHaveValue('  中文\nend  ');
  await page.getByRole('button', { name: '添加成对对话', exact: true }).click();
  await page.getByLabel('用户消息 1', { exact: true }).fill('明确的用户问题');
  await page.getByRole('button', { name: '核对映射预览', exact: true }).click();
  await expect(page.getByLabel('AI 回复 1', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await page.getByLabel('AI 回复 1', { exact: true }).fill('独立确认的回复');
  await page.getByRole('button', { name: '核对映射预览', exact: true }).click();
  await expect(page.getByText('请逐项核对字段映射后勾选确认', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: mappedConfirmation, exact: true }).check();
  await page.route(previewPath, (route) => route.abort('failed'));
  await page.getByRole('button', { name: '核对映射预览', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '请求未完成' })).toBeVisible();
  await expect(page.getByLabel('AI 回复 1', { exact: true })).toHaveValue('独立确认的回复');
  await page.unroute(previewPath);
  const previewResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/persona-imports/text/preview') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '核对映射预览', exact: true }).click();
  const prepared = ImportPreviewResponseSchema.parse(await (await previewResponse).json()).data;
  expect(prepared.persona.content).toMatchObject({ systemPrompt: '  中文\r\nend  ' });
  await page.getByLabel('人设名称', { exact: true }).fill('手动映射的星光角色');
  await page
    .getByLabel('文件来源说明', { exact: true })
    .fill('原作者提供的旧编码文本，仅映射明确核对的字段');
  await screenshot(page, directory, 'astrbot-preview.png');
  await page.getByRole('button', { name: '返回修改字段映射', exact: true }).click();
  await expect(page.getByLabel('系统提示词', { exact: true })).toHaveValue('  中文\nend  ');
  await page.getByRole('checkbox', { name: mappedConfirmation, exact: true }).check();
  await page.getByRole('button', { name: '核对映射预览', exact: true }).click();
  await expect(page.getByLabel('人设名称', { exact: true })).toHaveValue('手动映射的星光角色');
  await expect(page.getByLabel('文件来源说明', { exact: true })).toHaveValue(
    '原作者提供的旧编码文本，仅映射明确核对的字段',
  );
  await page.getByRole('checkbox', { name: importConfirmation, exact: true }).check();
  await page.getByRole('button', { name: '确认导入草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/personas\/[a-f0-9-]+\/edit$/);
  const id = page.url().split('/').at(-2);
  const result = DraftResponseSchema.parse(
    await (await page.request.get('/api/v1/me/personas/' + id + '/draft')).json(),
  );
  expect(result.data.draft.content).toMatchObject({
    systemPrompt: '  中文\r\nend  ',
    dialoguePairs: [{ user: '明确的用户问题', assistant: '独立确认的回复' }],
  });
  expect(result.data.draft.origin.type).toBe('repost');
  expect(result.data.draft.rightsAccepted).toBe(false);
});

test('UTF16 Markdown字面原文、MaiBot独立字段、更换确认和深色大字布局', async ({ page }, info) => {
  const directory = await openImport(page, info);
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  await page.getByRole('button', { name: 'MaiBot 三项正文', exact: true }).click();
  const text = '  # 星光🌟\r\n<script>window.untrusted = true</script>\r\n自然表达  ';
  await page.getByLabel('TXT / Markdown 文件', { exact: true }).setInputFiles({
    name: '作者的 Markdown.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('\ufeff' + text, 'utf16le').swap16(),
  });
  await page.getByRole('button', { name: '读取文本原文', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'UTF-16 BE · BOM 识别' })).toBeVisible();
  expect(await page.evaluate(() => Object.hasOwn(window, 'untrusted'))).toBe(false);
  await page.getByRole('button', { name: '全文填入人格设定', exact: true }).click();
  await expect(page.getByLabel('表达风格', { exact: true })).toHaveValue('');
  await page.getByLabel('表达风格', { exact: true }).fill('自然表达');
  await page.getByLabel('行为风格', { exact: true }).fill('尊重边界');
  await screenshot(page, directory, 'maibot-mapping.png');
  await page.getByRole('button', { name: '更换文件、编码或平台', exact: true }).click();
  await expect(page.getByRole('alertdialog', { name: '重新读取文本文件？' })).toBeVisible();
  await page.getByRole('button', { name: '保留当前映射', exact: true }).click();
  await expect(page.getByLabel('表达风格', { exact: true })).toHaveValue('自然表达');
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
    document.documentElement.style.fontSize = '32px';
  });
  for (const name of ['选中文本填入人格设定', '全文填入行为风格', '核对映射预览']) {
    const control = page.getByRole('button', { name, exact: true });
    const bounds = await control.boundingBox();
    if (!bounds) throw new Error('缺少映射控件边界');
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
  }
  await screenshot(page, directory, 'maibot-dark-large.png');
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.style.fontSize = '';
  });
  await page.getByRole('checkbox', { name: mappedConfirmation, exact: true }).check();
  const [maibotResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/persona-imports/text/preview') &&
        response.request().method() === 'POST',
      { timeout: 5000 },
    ),
    page.getByRole('button', { name: '核对映射预览', exact: true }).click(),
  ]);
  const maibot = ImportPreviewResponseSchema.parse(await maibotResponse.json()).data;
  expect(maibot.persona).toEqual({
    platform: 'maibot',
    content: { personality: text, replyStyle: '自然表达', behaviorStyle: '尊重边界' },
  });
  await expect(page.getByLabel('预览：人格设定', { exact: true })).toHaveValue(
    text.replace(/\r\n/g, '\n'),
  );
  await page.getByRole('button', { name: '返回修改字段映射', exact: true }).click();
  await page.getByRole('button', { name: '更换文件、编码或平台', exact: true }).click();
  await page.getByRole('button', { name: '清除映射并重新读取', exact: true }).click();
  await expect(page.getByRole('button', { name: '读取文本原文', exact: true })).toBeEnabled();
  await expect(page.getByLabel('文本原文（只读）', { exact: true })).toHaveCount(0);
});

test('读取取消与会话失效保留当前文件，跨账号不会沿用私有映射', async ({ page }, info) => {
  await openImport(page, info);
  await page.getByRole('button', { name: 'AstrBot 人格与对话', exact: true }).click();
  await page.getByLabel('TXT / Markdown 文件', { exact: true }).setInputFiles({
    name: '仅当前账号.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('账号私有原文'),
  });
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(sourcePath, async (route) => {
    await gate;
    await route.abort().catch(() => undefined);
  });
  await page.getByRole('button', { name: '读取文本原文', exact: true }).click();
  await page.getByRole('button', { name: '取消读取', exact: true }).click();
  await expect(page.getByText('已取消读取，当前文件仍保留', { exact: true })).toBeVisible();
  release();
  await page.unroute(sourcePath);
  expect((await browserWrite(page, '/api/v1/auth/logout')).status()).toBe(200);
  await page.getByRole('button', { name: '读取文本原文', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /登录|账号/ })).toBeVisible();
  expect(
    await page
      .getByLabel('TXT / Markdown 文件', { exact: true })
      .evaluate((input: HTMLInputElement) => input.files?.[0]?.name),
  ).toBe('仅当前账号.txt');
  page.once('dialog', (dialog) => dialog.accept());
  await loginCreator(page);
  await page.goto('/dashboard/personas/import');
  await page.getByRole('tab', { name: 'TXT / Markdown', exact: true }).click();
  expect(
    await page
      .getByLabel('TXT / Markdown 文件', { exact: true })
      .evaluate((input: HTMLInputElement) => input.files?.length),
  ).toBe(0);
  await expect(page.getByLabel('文本原文（只读）', { exact: true })).toHaveCount(0);
});

test('入口大字、长文件名和键盘编码菜单保持可达与可读', async ({ page }, info) => {
  const directory = await openImport(page, info);
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
    document.documentElement.style.fontSize = '32px';
  });
  for (const name of ['MaiBot 三项正文', 'AstrBot 人格与对话']) {
    const bounds = await page.getByRole('button', { name, exact: true }).boundingBox();
    if (!bounds) throw new Error('缺少目标平台选项边界');
    expect.soft(bounds.x + bounds.width, name).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
    expect.soft(bounds.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole('combobox', { name: '文件编码', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('combobox', { name: '文件编码', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'AstrBot 人格与对话', exact: true }).click();
  const tooLong = 'very-long-author-filename-'.repeat(6) + '原始角色文档.txt';
  await page
    .getByLabel('TXT / Markdown 文件', { exact: true })
    .setInputFiles({ name: tooLong, mimeType: 'text/plain', buffer: Buffer.from('完整原文') });
  await page.getByRole('button', { name: '读取文本原文', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '有效文件名' })).toBeVisible();
  expect(
    await page
      .getByLabel('TXT / Markdown 文件', { exact: true })
      .evaluate((input: HTMLInputElement) => input.files?.[0]?.name),
  ).toBe(tooLong);
  const filename = 'very-long-author-filename-'.repeat(5) + '原始角色文档.txt';
  await page
    .getByLabel('TXT / Markdown 文件', { exact: true })
    .setInputFiles({ name: filename, mimeType: 'text/plain', buffer: Buffer.from('完整原文') });
  await page.getByRole('button', { name: '读取文本原文', exact: true }).click();
  await expect(page.getByLabel('文本原文（只读）', { exact: true })).toBeVisible();
  expect
    .soft(
      await page
        .getByText(filename, { exact: true })
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    )
    .toBe(true);
  await screenshot(page, directory, 'text-long-filename-dark-large.png');
});
