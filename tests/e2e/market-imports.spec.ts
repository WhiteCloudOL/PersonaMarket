import { selectTheme } from '../fixtures/theme.js';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loginCreator, browserWrite } from '../fixtures/browser-account.js';
import { marketPersona } from '../fixtures/market-personas.js';
import { fixturePng } from '../fixtures/image.js';
import { createMarketArchive } from '@personamarket/persona-adapters';
import { DraftResponseSchema, MarketPersonaSchema } from '@personamarket/contracts';
test.use({ trace: 'off', screenshot: 'off' });

async function openImport(page: Page, info: TestInfo) {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  await loginCreator(page);
  await page.goto('/dashboard/personas/import');
  await expect(page.getByRole('heading', { name: '导入人设', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '选择人设文件', exact: true })).toBeVisible();
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('缺少视口');
  const phase = process.env['IMPORT_CAPTURE_PHASE'] === 'before' ? 'before' : 'current';
  const directory = join(
    'data/tests/new-machine-design/imports',
    phase,
    `${viewport.width}x${viewport.height}`,
  );
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, 'entry.png') });
  await expect(page.getByRole('tab', { name: '通用 JSON / ZIP', exact: true })).toBeVisible();
  return directory;
}
test('通用JSON三步导入、来源输入保留与真实失败重试', async ({ page }, info) => {
  const directory = await openImport(page, info);
  const importedDocument = marketPersona('astrbot');
  const longTag = '星光'.repeat(40);
  importedDocument.metadata.tagNames = [longTag];
  await page.getByLabel('通用人设文件', { exact: true }).setInputFiles({
    name: '星光书房.persona.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(importedDocument)),
  });
  await page.getByRole('button', { name: '预览导入内容', exact: true }).click();
  await expect(page.getByRole('heading', { name: '核对导入内容', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '导入工作区', exact: true })).toBeFocused();
  const tag = page.getByText(longTag, { exact: true }).first();
  await expect(tag).toBeVisible();
  expect(await tag.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true);
  await page.screenshot({ path: join(directory, 'json-review.png') });
  await page.getByRole('button', { name: '确认内容，下一步', exact: true }).click();
  await expect(page.getByRole('heading', { name: '来源与保存位置', exact: true })).toBeVisible();
  await page.getByLabel('导入后的人设名称', { exact: true }).fill('保留原文的星光角色');
  await page.getByLabel('来源说明', { exact: true }).fill('来自原作者公开文件，已核实来源');
  await page.getByLabel('本次转载依据', { exact: true }).fill('原作者同意署名转载，保留来源与许可');
  await page
    .getByRole('checkbox', {
      name: '我已核对正文、图片和来源，确认按上述范围导入私有草稿',
      exact: true,
    })
    .check();
  await page.screenshot({ path: join(directory, 'json-confirm.png') });
  const endpoint = '**/api/v1/me/market-imports/confirm';
  await page.route(endpoint, (route) => route.abort('failed'));
  await page.getByRole('button', { name: '确认导入草稿', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '请求未完成' })).toBeVisible();
  await expect(page.getByLabel('来源说明', { exact: true })).toHaveValue(
    '来自原作者公开文件，已核实来源',
  );
  await expect(
    page.getByRole('checkbox', {
      name: '我已核对正文、图片和来源，确认按上述范围导入私有草稿',
      exact: true,
    }),
  ).toBeChecked();
  await page.unroute(endpoint);
  await page.getByRole('button', { name: '返回核对内容', exact: true }).click();
  await page.getByRole('button', { name: '确认内容，下一步', exact: true }).click();
  await expect(page.getByLabel('本次转载依据', { exact: true })).toHaveValue(
    '原作者同意署名转载，保留来源与许可',
  );
  await page.getByRole('button', { name: '确认导入草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/personas\/[a-f0-9-]+\/edit$/);
  const id = page.url().split('/').at(-2);
  if (!id) throw new Error('缺少真实草稿');
  const saved = DraftResponseSchema.parse(
    await (await page.request.get('/api/v1/me/personas/' + id + '/draft')).json(),
  );
  expect(saved.data.draft.content).toMatchObject(importedDocument.content);
  expect(saved.data.draft.rightsAccepted).toBe(false);
  expect(saved.data.draft.origin).toMatchObject({ type: 'repost', originalAuthor: '原作者' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('完整ZIP图片预览、深色大字、键盘与主动取消', async ({ page }, info) => {
  const directory = await openImport(page, info);
  const key = '3cabba2c-340d-4edb-8357-a1404f6f878a';
  const importedDocument = marketPersona();
  const portable = MarketPersonaSchema.parse({
    ...importedDocument,
    metadata: {
      ...importedDocument.metadata,
      avatarKey: key,
      readmeMarkdown: `# 图文原稿\n\n![图片](assets/${key}.png)`,
    },
    assets: [
      {
        key,
        path: `assets/${key}.png`,
        mimeType: 'image/png',
        bytes: fixturePng.length,
        sha256: createHash('sha256').update(fixturePng).digest('hex'),
      },
    ],
  });
  const chunks: Uint8Array[] = [];
  for await (const chunk of createMarketArchive(portable, async () => fixturePng, new Date())) {
    if (!(chunk instanceof Uint8Array)) throw new Error('无效测试流');
    chunks.push(chunk);
  }
  await page.getByLabel('通用人设文件', { exact: true }).setInputFiles({
    name: '完整星光.persona.zip',
    mimeType: 'application/zip',
    buffer: Buffer.concat(chunks),
  });
  await page.getByRole('button', { name: '预览导入内容', exact: true }).click();
  await expect(page.getByText('已校验并托管', { exact: true })).toBeVisible();
  const picture = page.getByRole('img', { name: '已托管的第1张图片', exact: true });
  await expect
    .poll(() =>
      picture.evaluate(
        (node) => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0,
      ),
    )
    .toBe(true);
  await page.getByRole('tab', { name: 'README', exact: true }).click();
  const markdownImage = page.getByRole('img', { name: '图片', exact: true });
  await expect
    .poll(() =>
      markdownImage.evaluate(
        (node) => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0,
      ),
    )
    .toBe(true);
  await page.screenshot({ path: join(directory, 'zip-readme.png') });
  await selectTheme(page, 'dark');
  await page.getByRole('tab', { name: '人设正文', exact: true }).click();
  await page.getByRole('tab', { name: '人设正文', exact: true }).press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'README', exact: true })).toBeFocused();
  await page.screenshot({ path: join(directory, 'zip-dark.png') });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await page.screenshot({ path: join(directory, 'zip-large-text.png') });
  const overflow = await page.evaluate(() => ({
    width: innerWidth,
    page: document.documentElement.scrollWidth,
    nodes: Array.from(document.querySelectorAll('body *'))
      .flatMap((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 1 && rect.right > innerWidth + 1
          ? [
              {
                tag: node.tagName,
                id: node.id,
                className: typeof node.className === 'string' ? node.className : '',
                width: rect.width,
                right: rect.right,
              },
            ]
          : [];
      })
      .slice(0, 18),
  }));
  expect(overflow.page, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
  const id = await picture.getAttribute('src');
  if (!id) throw new Error('缺少临时图地址');
  await page.getByRole('button', { name: '重新选择文件', exact: true }).click();
  await expect(page.getByRole('button', { name: '选择人设文件', exact: true })).toBeVisible();
  expect((await page.request.get(id)).status()).toBe(404);
});
test('发送文件前复查实际账号，Cookie换号后不把旧文件传给新账号', async ({
  page,
  browser,
}, info) => {
  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    const account = await loginCreator(other);
    await openImport(page, info);
    await page.getByLabel('通用人设文件', { exact: true }).setInputFiles({
      name: '前一个账号的私有文件.persona.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(marketPersona())),
    });
    let uploads = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/v1/me/market-imports/preview') uploads++;
    });
    // 真实API更换会话但不发送前端广播，复现界面缓存仍属于旧账号的窗口
    expect(
      (
        await browserWrite(page, '/api/v1/auth/login', {
          identifier: account.username,
          password: account.password,
        })
      ).status(),
    ).toBe(200);
    await page.getByRole('button', { name: '预览导入内容', exact: true }).click();
    await expect(page.getByText('前一个账号的私有文件.persona.json', { exact: true })).toHaveCount(
      0,
    );
    expect(
      await page
        .getByLabel('通用人设文件', { exact: true })
        .evaluate((node) => (node instanceof HTMLInputElement ? node.files?.length : -1)),
    ).toBe(0);
    expect(uploads).toBe(0);
  } finally {
    await context.close();
  }
});
test('JSON待托管图片的地址拒绝、原图校验与补图后保存', async ({ page }, info) => {
  const directory = await openImport(page, info);
  const key = '3cabba2c-340d-4edb-8357-a1404f6f878a';
  const original = marketPersona();
  const portable = MarketPersonaSchema.parse({
    ...original,
    metadata: {
      ...original.metadata,
      avatarKey: key,
      readmeMarkdown: `# 图文原稿\n\n![图片](asset://${key})`,
    },
    assets: [
      {
        key,
        url: 'http://127.0.0.1/never-fetch',
        mimeType: 'image/png',
        bytes: fixturePng.length,
        sha256: createHash('sha256').update(fixturePng).digest('hex'),
      },
    ],
  });
  await page.getByLabel('通用人设文件', { exact: true }).setInputFiles({
    name: '待补图.persona.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(portable)),
  });
  await page.getByRole('button', { name: '预览导入内容', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认内容，下一步', exact: true })).toBeDisabled();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: join(directory, 'pending-large-text.png') });
  await page.getByRole('region', { name: '图片 1', exact: true }).screenshot({
    path: join(directory, 'pending-image-large-text.png'),
  });
  await page.getByRole('region', { name: '图片 1', exact: true }).evaluate((element) => {
    const headerHeight = document.querySelector('header')?.getBoundingClientRect().height ?? 0;
    window.scrollBy(0, element.getBoundingClientRect().top - headerHeight - 16);
  });
  await page.screenshot({ path: join(directory, 'pending-image-large-text-viewport.png') });
  const imageTitle = page.getByRole('region', { name: '图片 1', exact: true }).locator('p').first();
  expect(
    await imageTitle.evaluate((element) => {
      const text = [...element.childNodes].find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes('图片'),
      );
      if (!text) throw new Error('缺少图片名称文本');
      const range = document.createRange();
      range.selectNodeContents(text);
      return range.getClientRects().length;
    }),
  ).toBe(1);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
  await page.getByRole('button', { name: '确认导入在线图片', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '公网 HTTPS' })).toBeVisible();
  await page.getByLabel('上传匹配的原图', { exact: true }).setInputFiles({
    name: 'wrong.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(fixturePng.length),
  });
  await expect(page.getByRole('alert').filter({ hasText: 'SHA-256' })).toBeVisible();
  await page
    .getByLabel('上传匹配的原图', { exact: true })
    .setInputFiles({ name: 'source.png', mimeType: 'image/png', buffer: fixturePng });
  await expect(page.getByText('已校验并托管', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '确认内容，下一步', exact: true }).click();
  await page
    .getByRole('checkbox', {
      name: '我已核对正文、图片和来源，确认按上述范围导入私有草稿',
      exact: true,
    })
    .check();
  await page.getByRole('button', { name: '确认导入草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/personas\/[a-f0-9-]+\/edit$/);
  const id = page.url().split('/').at(-2);
  if (!id) throw new Error('缺少真实草稿');
  const saved = DraftResponseSchema.parse(
    await (await page.request.get('/api/v1/me/personas/' + id + '/draft')).json(),
  );
  expect(saved.data.draft.avatarAssetId).toBeTruthy();
  expect(saved.data.draft.avatarAssetId).not.toBe(key);
});
