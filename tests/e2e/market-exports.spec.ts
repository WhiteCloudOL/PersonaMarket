import { selectTheme } from '../fixtures/theme.js';
import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { fromBufferPromise } from 'yauzl';
import { parseMarketPersona } from '@personamarket/persona-adapters';
import { loginCreator } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { visualPersonas } from '../fixtures/visual-personas.js';
test.use({ trace: 'off', screenshot: 'off' });

async function download(page: Page, format: string) {
  const response = page.waitForResponse((reply) => {
    const url = new URL(reply.url());
    return url.pathname.endsWith('/export') && url.searchParams.get('format') === format;
  });
  const file = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载文件', exact: true }).click();
  const [reply, downloaded] = await Promise.all([response, file]);
  expect(reply.status()).toBe(200);
  const path = await downloaded.path();
  if (!path) throw new Error('下载文件不存在');
  const bytes = await readFile(path);
  return { filename: downloaded.suggestedFilename(), content: bytes.toString('utf8'), bytes };
}

test('公开历史版本的JSON、Markdown与完整ZIP下载、取消重试和双端面板', async ({
  page,
  browser,
}, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  await loginCreator(page);
  const context = await browser.newContext();
  try {
    const admin = await context.newPage();
    await loginBrowserAdmin(admin);
    const records = await visualPersonas(page, admin);
    await page.goto(`/personas/${records.maibot.id}/releases/${records.maibot.releaseId}`);
    const open = page.getByRole('button', { name: '导出', exact: true });
    await open.click();
    const dialog = page.getByRole('dialog', { name: '导出这个版本' });
    await expect(dialog.getByRole('textbox', { name: '导出内容预览' })).toBeVisible();
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('缺少视口');
    const phase = process.env['EXPORT_CAPTURE_PHASE'] === 'before' ? 'before' : 'current';
    const directory = join(
      'data/tests/new-machine-design/exports-zip',
      phase,
      `${viewport.width}x${viewport.height}`,
    );
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: join(directory, 'native-preview.png') });
    const json = dialog.getByRole('button', { name: '通用 JSON', exact: true });
    await expect(json).toBeVisible();
    await json.click();
    await expect(dialog.getByRole('textbox', { name: '导出内容预览' })).toHaveValue(
      /"format": "qingzheng-persona"/,
    );
    const measureContrast = (element: Element) => {
      const description = document.getElementById(element.getAttribute('aria-describedby') ?? '');
      if (!description) throw new Error('格式说明未关联可访问描述');
      const context = document.createElement('canvas').getContext('2d');
      if (!context) throw new Error('无法测量文字对比度');
      const luminance = (color: string) => {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const values = Array.from(context.getImageData(0, 0, 1, 1).data)
          .slice(0, 3)
          .map((value) => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
        return (values[0] ?? 0) * 0.2126 + (values[1] ?? 0) * 0.7152 + (values[2] ?? 0) * 0.0722;
      };
      const foreground = luminance(getComputedStyle(description).color);
      const background = luminance(getComputedStyle(element).backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    };
    const contrast = await json.evaluate(measureContrast);
    expect(contrast, '选中格式的说明文字应达到普通文字4.5:1对比度').toBeGreaterThanOrEqual(4.5);
    const bounds = await json.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await page.screenshot({ path: join(directory, 'market-json-preview.png') });
    let aborted = false;
    await page.route('**/api/v1/personas/*/releases/*/export?format=market-json', async (route) => {
      if (!aborted) {
        aborted = true;
        await route.abort();
      } else await route.continue();
    });
    await dialog.getByRole('button', { name: '下载文件', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('下载失败');
    await expect(dialog.getByRole('textbox', { name: '导出内容预览' })).toHaveValue(
      /"format": "qingzheng-persona"/,
    );
    const result = await download(page, 'market-json');
    expect(result.filename).toMatch(/\.persona\.json$/);
    const portableDocument = parseMarketPersona(Buffer.from(result.content), 'json');
    expect(portableDocument.metadata.title).toBe(records.maibot.title);
    expect(portableDocument.source?.version).toBe('1.0.0');
    expect(portableDocument.assets).toHaveLength(1);
    await dialog.getByRole('button', { name: 'Markdown', exact: true }).click();
    await expect(dialog.getByRole('textbox', { name: '导出内容预览' })).toHaveValue(/## 人格设定/);
    const markdown = await download(page, 'markdown');
    expect(markdown.filename).toMatch(/\.md$/);
    expect(markdown.content).toContain('你是晴野诗织');
    await dialog.getByRole('button', { name: '完整 ZIP 包', exact: true }).click();
    const archivePreview = dialog.getByRole('textbox', { name: '归档清单预览' });
    await expect(archivePreview).toHaveValue(/assets\//);
    await page.screenshot({ path: join(directory, 'zip-preview.png') });
    let releaseTransfer: () => void = () => {};
    const pendingTransfer = new Promise<void>((resolve) => {
      releaseTransfer = resolve;
    });
    let transferStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      transferStarted = resolve;
    });
    const pattern = '**/api/v1/personas/*/releases/*/export?format=market-zip';
    await page.route(pattern, async (route) => {
      const response = await route.fetch();
      transferStarted();
      await pendingTransfer;
      // 真实响应已取得，取消后的路由只做清理，不伪造成功或归档内容
      await route.fulfill({ response }).catch(() => undefined);
    });
    try {
      await dialog.getByRole('button', { name: '下载文件', exact: true }).click();
      await started;
      await dialog.getByRole('button', { name: '取消下载', exact: true }).click();
      await expect(dialog.getByRole('status')).toContainText('下载已取消');
      await expect(archivePreview).toHaveValue(/"format": "qingzheng-persona"/);
    } finally {
      releaseTransfer();
      await page.unroute(pattern);
    }
    const zipped = await download(page, 'market-zip');
    expect(zipped.filename).toMatch(/\.persona\.zip$/);
    const archive = await fromBufferPromise(zipped.bytes, {
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
    const files = new Map<string, Buffer>();
    try {
      for await (const entry of archive.eachEntry()) {
        const chunks: Uint8Array[] = [];
        for await (const chunk of await archive.openReadStreamPromise(entry)) {
          if (!(chunk instanceof Uint8Array)) throw new Error('错误的归档字节');
          chunks.push(chunk);
        }
        const bytes = Buffer.concat(chunks);
        expect(crc32(bytes)).toBe(entry.crc32);
        files.set(entry.fileName, bytes);
      }
    } finally {
      archive.close();
    }
    const manifest = files.get('persona.json');
    if (!manifest) throw new Error('归档缺少清单');
    const zippedDocument = parseMarketPersona(manifest, 'zip');
    expect(zippedDocument.metadata.title).toBe(records.maibot.title);
    expect(files.size).toBe(4);
    expect(files.get('README.md')?.toString()).toBe(zippedDocument.metadata.readmeMarkdown);
    expect(files.has('LICENSE.txt')).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(open).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await selectTheme(page, 'dark');
    await open.click();
    await json.click();
    await expect(dialog.getByRole('textbox', { name: '导出内容预览' })).toHaveValue(
      /"format": "qingzheng-persona"/,
    );
    expect(await json.evaluate(measureContrast), '深色选中说明文字对比度').toBeGreaterThanOrEqual(
      4.5,
    );
    await page.screenshot({ path: join(directory, 'market-json-dark.png') });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await expect(dialog.getByRole('button', { name: '下载文件', exact: true })).toBeVisible();
    await page.screenshot({ path: join(directory, 'market-json-large-text.png') });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
    await page.keyboard.press('Escape');
    await expect(open).toBeFocused();
  } finally {
    await context.close();
  }
});
