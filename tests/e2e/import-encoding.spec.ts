import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loginCreator } from '../fixtures/browser-account.js';
import { DraftResponseSchema } from '@personamarket/contracts';
import { marketPersona } from '../fixtures/market-personas.js';

test.use({ trace: 'off', screenshot: 'off' });

async function openImport(page: Page, info: TestInfo) {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  await loginCreator(page);
  await page.goto('/dashboard/personas/import');
  await page.getByRole('tab', { name: '平台原生文件', exact: true }).click();
  await expect(page.getByLabel('原生人设文件', { exact: true })).toBeVisible();
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('缺少测试视口');
  const directory = join(
    'data/tests/import-encoding',
    process.env['IMPORT_CAPTURE_PHASE'] === 'before' ? 'before' : 'current',
    `${viewport.width}x${viewport.height}`,
  );
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, 'native-entry.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  return directory;
}
async function selectEncoding(page: Page, label: string) {
  await page.getByRole('combobox', { name: '文件编码', exact: true }).click();
  await page.getByRole('option', { name: label, exact: true }).click();
}

test('GBK自动预览、手动错误后切换编码、网络失败保留来源并真实确认', async ({ page }, info) => {
  const directory = await openImport(page, info);
  await page.getByRole('button', { name: 'AstrBot JSON', exact: true }).click();
  const prefix = Buffer.concat([
    Buffer.from('{"system_prompt":"  '),
    Buffer.from([0xd6, 0xd0, 0xce, 0xc4]),
    Buffer.from('\\r\\nend  ","begin_dialogs":["question","answer"]}'),
  ]);
  const bytes = Buffer.concat([prefix, Buffer.alloc(2 * 1024 * 1024 + 1 - prefix.length, 0x20)]);
  await page
    .getByLabel('原生人设文件', { exact: true })
    .setInputFiles({ name: '中文原文.json', mimeType: 'application/json', buffer: bytes });
  await selectEncoding(page, 'UTF-8');
  await page.getByRole('button', { name: '预览导入内容', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '无法按 UTF-8' })).toBeVisible();
  expect(
    await page
      .getByLabel('原生人设文件', { exact: true })
      .evaluate((input: HTMLInputElement) => input.files?.[0]?.name),
  ).toBe('中文原文.json');
  await selectEncoding(page, '自动识别（推荐）');
  await page.getByRole('button', { name: '预览导入内容', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'GB18030 · 自动回退' })).toBeVisible();
  const prompt = page.getByText('中文 end', { exact: true });
  expect(await prompt.textContent()).toBe('  中文\r\nend  ');
  await page.screenshot({ path: join(directory, 'gbk-review.png'), fullPage: true });
  await page.getByLabel('人设名称', { exact: true }).fill('保留编码与换行的角色');
  await page
    .getByLabel('文件来源说明', { exact: true })
    .fill('原作者提供的GBK文件，保留原文与许可待核实');
  await page
    .getByRole('checkbox', {
      name: '我已核对正文、忽略字段和来源，确认按上述范围导入私有草稿',
      exact: true,
    })
    .check();
  const confirmPath = '**/api/v1/me/persona-imports/confirm';
  await page.route(confirmPath, (route) => route.abort('failed'));
  await page.getByRole('button', { name: '确认导入草稿', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '请求未完成' })).toBeVisible();
  await expect(page.getByLabel('文件来源说明', { exact: true })).toHaveValue(
    '原作者提供的GBK文件，保留原文与许可待核实',
  );
  await page.unroute(confirmPath);
  await page.getByRole('button', { name: '确认导入草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/personas\/[a-f0-9-]+\/edit$/);
  const id = page.url().split('/').at(-2);
  if (!id) throw new Error('缺少实际草稿ID');
  const draft = DraftResponseSchema.parse(
    await (await page.request.get('/api/v1/me/personas/' + id + '/draft')).json(),
  ).data.draft;
  expect(draft.content).toMatchObject({ systemPrompt: '  中文\r\nend  ' });
  expect(draft.rightsAccepted).toBe(false);
  expect(draft.origin.type).toBe('repost');
});

test('UTF16 BOM自动识别、深色大字与键盘选择编码', async ({ page }, info) => {
  const directory = await openImport(page, info);
  await page.getByRole('button', { name: 'AstrBot JSON', exact: true }).click();
  const source = '{"system_prompt":"  星光🌟\\r\\n第二行  ","begin_dialogs":[]}';
  const bytes = Buffer.from('\ufeff' + source, 'utf16le').swap16();
  await page
    .getByLabel('原生人设文件', { exact: true })
    .setInputFiles({ name: '星光 UTF16.json', mimeType: 'application/json', buffer: bytes });
  await page.getByRole('button', { name: '预览导入内容', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'UTF-16 BE · BOM 识别' })).toBeVisible();
  expect(await page.getByText('星光🌟 第二行', { exact: true }).textContent()).toBe(
    '  星光🌟\r\n第二行  ',
  );
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
    document.documentElement.style.fontSize = '32px';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const format = page.getByRole('button', { name: 'AstrBot JSON', exact: true });
  const bounds = await format.boundingBox();
  if (!bounds) throw new Error('缺少原生格式按钮边界');
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
  await page.screenshot({ path: join(directory, 'utf16-dark-large.png'), fullPage: true });
  await page.getByRole('combobox', { name: '文件编码', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('combobox', { name: '文件编码', exact: true })).toBeFocused();
});

test('通用JSON手动选择UTF16，无BOM文件也能预览', async ({ page }, info) => {
  await openImport(page, info);
  await page.getByRole('tab', { name: '通用 JSON / ZIP', exact: true }).click();
  const document = marketPersona('astrbot');
  await page.getByLabel('通用人设文件', { exact: true }).setInputFiles({
    name: '手动编码.persona.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(document), 'utf16le'),
  });
  await selectEncoding(page, 'UTF-16 LE');
  await page.getByRole('button', { name: '预览导入内容', exact: true }).click();
  await expect(page.getByRole('heading', { name: '核对导入内容', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'UTF-16 LE · 手动选择' })).toBeVisible();
  await expect(page.getByText('星光书房', { exact: true })).toBeVisible();
});
