import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loginCreator } from '../fixtures/browser-account.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });

async function capture(page: Page, info: TestInfo, name: string, fullPage = true) {
  await page.evaluate(() => document.fonts.ready);
  const size = page.viewportSize();
  if (!size) throw new Error('缺少真实浏览器视口');
  const phase = process.env['CREATOR_LAYOUT_CAPTURE_PHASE'] === 'before' ? 'before' : 'current';
  const directory = join('data/tests/creator-layout', phase, `${size.width}x${size.height}`);
  await mkdir(directory, { recursive: true });
  const path = join(directory, name);
  if (fullPage) await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path, fullPage });
  await info.attach(name, { path, contentType: 'image/png' });
  return directory;
}

test('创建页内容检查在反复输入与真实滚动中保持唯一，手机平台卡片可读并支持预览定位', async ({
  page,
}, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  await loginCreator(page);
  await page.goto('/dashboard/personas/new');
  await expect(page.getByLabel('人设名称', { exact: true })).toBeVisible();
  await capture(page, info, 'empty.png');
  await page
    .getByLabel('人设名称', { exact: true })
    .fill('书页与星光 · CreativeStoryGarden'.repeat(2));
  await page
    .getByLabel('一句话简介', { exact: true })
    .fill('在长长的中文故事与英文模型名称间保持清晰的创作节奏');
  await page.getByLabel('表达风格', { exact: true }).fill('亲切自然');
  await page.getByLabel('行为风格', { exact: true }).fill('认真倾听与尊重边界');
  for (let index = 0; index < 12; index++) {
    await page.getByLabel('人格设定', { exact: true }).fill('第' + index + '次编辑的内容检查原稿');
    await expect(
      page.getByRole('heading', { name: '内容检查', exact: true, includeHidden: true }),
    ).toHaveCount(1);
  }
  const region = page.getByRole('region', { name: '作品预览与内容检查', exact: true });
  const desktop = await region.isVisible();
  const positions: unknown[] = [];
  if (desktop) {
    await expect(region.getByRole('heading', { name: '内容检查', exact: true })).toHaveCount(1);
    await expect(region.getByRole('button')).toHaveCount(2);
    await region.getByRole('button', { name: '查看全部检查', exact: true }).click();
    const checks = region.getByRole('button', { name: /(?:已就绪|去完善)$/ });
    await expect(checks).toHaveCount(6);
    for (const [name, fraction] of [
      ['top', 0],
      ['middle', 0.5],
      ['bottom', 1],
    ] as const) {
      await page.evaluate(
        (fraction) => scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * fraction),
        fraction,
      );
      await expect(region.getByRole('heading', { name: '内容检查', exact: true })).toHaveCount(1);
      await expect(checks).toHaveCount(6);
      await expect(
        region.getByRole('button', { name: '收起检查清单', exact: true }),
      ).toHaveAttribute('aria-expanded', 'true');
      positions.push(
        await region.evaluate((element) => ({
          scrollY,
          top: element.getBoundingClientRect().top,
          height: element.getBoundingClientRect().height,
          nodes: [...document.querySelectorAll('h2')].filter(
            (heading) => heading.textContent === '内容检查',
          ).length,
          items: element.querySelectorAll('button').length,
        })),
      );
      await capture(page, info, 'scroll-' + name + '.png', false);
    }
    await region.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await capture(page, info, 'checks-scroll-end.png', false);
    await region.evaluate((element) => {
      element.scrollTop = 0;
    });
    await capture(page, info, 'full-after-scroll.png');
  } else {
    await page.getByRole('button', { name: '预览', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: '发布预览', exact: true });
    await expect(sheet.getByRole('heading', { name: '内容检查', exact: true })).toHaveCount(1);
    await expect(sheet.getByRole('button', { name: /平台正文与对话/ })).toHaveCount(0);
    await sheet.getByRole('button', { name: '查看全部检查', exact: true }).click();
    await expect(sheet.getByRole('button', { name: /(?:已就绪|去完善)$/ })).toHaveCount(6);
    await expect(sheet.getByRole('button', { name: /平台正文与对话/ })).toHaveCount(1);
    await capture(page, info, 'preview-sheet.png', false);
    await sheet.getByRole('button', { name: /平台正文与对话/ }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByLabel('人格设定', { exact: true })).toBeFocused();
    await expect(page.getByLabel('人格设定', { exact: true })).toHaveValue(
      '第11次编辑的内容检查原稿',
    );
    await expect(
      page.getByRole('heading', { name: '内容检查', exact: true, includeHidden: true }),
    ).toHaveCount(1);
  }
  const layouts: Array<{ width: number; vertical: boolean; gap: number }> = [];
  const viewports =
    info.project.name === 'mobile'
      ? ([
          [360, 800],
          [390, 844],
          [430, 932],
        ] as const)
      : [page.viewportSize() && [page.viewportSize()?.width, page.viewportSize()?.height]];
  for (const size of viewports) {
    const width = size?.[0],
      height = size?.[1];
    if (!width || !height) throw new Error('缺少布局视口');
    await page.setViewportSize({ width, height });
    const mai = page.getByRole('button', { name: 'MaiBot', exact: true });
    const astr = page.getByRole('button', { name: 'AstrBot', exact: true });
    await mai.scrollIntoViewIfNeeded();
    const first = await mai.boundingBox(),
      second = await astr.boundingBox();
    if (!first || !second) throw new Error('缺少真实平台卡片');
    expect(first.height).toBeGreaterThanOrEqual(44);
    expect(second.height).toBeGreaterThanOrEqual(44);
    layouts.push({
      width,
      vertical: second.y >= first.y + first.height,
      gap: Math.round(second.y - first.y - first.height),
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await capture(page, info, 'filled.png');
  }
  const directory = await capture(page, info, 'filled-viewport.png', false);
  await writeFile(
    join(directory, 'dom-layout.json'),
    JSON.stringify({ desktop, positions, layouts }, null, 2),
  );
  expect(layouts.filter((item) => item.width < 430).every((item) => item.vertical)).toBe(true);
  await page.getByRole('button', { name: /^主题偏好：/ }).click();
  await page.getByRole('menuitemradio', { name: '深色', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await page.getByRole('button', { name: 'MaiBot', exact: true }).scrollIntoViewIfNeeded();
  await capture(page, info, 'dark-large-platform.png', false);
  const overflow = await page
    .locator('#platform-selection button')
    .evaluateAll((elements) =>
      elements
        .filter((element) => element.scrollWidth > element.clientWidth + 1)
        .map((element) => element.textContent),
    );
  const actionOverflow = await page
    .getByRole('button', { name: /^(创建私有草稿|创建版本)$/ })
    .evaluateAll((elements) =>
      elements
        .filter((element) => element.scrollWidth > element.clientWidth + 1)
        .map((element) => element.textContent),
    );
  await writeFile(
    join(directory, 'large-layout.json'),
    JSON.stringify(
      {
        overflow,
        actionOverflow,
        pageWidth: await page.evaluate(() => document.documentElement.scrollWidth),
        viewport: page.viewportSize(),
      },
      null,
      2,
    ),
  );
  expect(actionOverflow).toEqual([]);
  expect(overflow).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
