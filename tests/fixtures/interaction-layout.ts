import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, type Page, type TestInfo } from '@playwright/test';

export async function captureInteraction(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  for (const image of await page.locator('#main img').all()) {
    if (!(await image.isVisible())) continue;
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        image.evaluate(
          (element) =>
            element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0,
        ),
      )
      .toBe(true);
  }
  const size = page.viewportSize();
  if (!size) throw new Error('缺少浏览器视口');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const control of await page
    .locator('[aria-label="作品互动"] button, [aria-label="作品互动"] a')
    .all()) {
    if (!(await control.isVisible())) continue;
    const bounds = await control.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
  }
  const brokenLabels = await page
    .locator('[aria-label="作品互动"] button, [aria-label="作品互动"] a')
    .evaluateAll((buttons) =>
      buttons.flatMap((button) => {
        const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
        const broken: string[] = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const label = node.textContent?.trim();
          if (label !== '点赞' && label !== '收藏') continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const rectangles = [...range.getClientRects()].filter(
            (rect) => rect.width > 0 && rect.height > 0,
          );
          if (rectangles.length > 1) broken.push(label);
        }
        return broken;
      }),
    );
  expect(brokenLabels, '点赞与收藏的操作词应完整显示，不能逐字竖排').toEqual([]);
  expect(await page.locator('#main a button, #main a a').count()).toBe(0);
  const directory = join('data/tests/interactions/current', `${size.width}x${size.height}`);
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => scrollTo(0, 0));
  const path = join(directory, name + '.png');
  await page.screenshot({ path, fullPage: true });
  await page.screenshot({ path: join(directory, name + '-viewport.png') });
  await info.attach(name, { path, contentType: 'image/png' });
}
