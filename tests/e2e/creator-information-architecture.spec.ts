import { expect, test, type Browser, type Page } from '@playwright/test';
import { DraftResponseSchema } from '@personamarket/contracts';
import { loginCreator } from '../fixtures/browser-account.js';

test.use({ trace: 'off', screenshot: 'off' });

async function creatorContext(browser: Browser, project: string) {
  const mobile = project === 'mobile';
  const context = await browser.newContext({
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    viewport: mobile
      ? { width: 390, height: 844 }
      : project === 'tablet'
        ? { width: 768, height: 1024 }
        : { width: 1440, height: 900 },
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: 'reduce',
  });
  return { context, page: await context.newPage(), mobile };
}

async function preview(page: Page, touch: boolean) {
  const sidebar = page.locator('#main aside');
  if (await sidebar.isVisible()) return { surface: sidebar, sheet: false };
  const trigger = page.getByRole('button', { name: '预览', exact: true });
  if (touch) await trigger.tap();
  else await trigger.click();
  const surface = page.getByRole('dialog', { name: '发布预览', exact: true });
  await expect(surface).toBeVisible();
  return { surface, sheet: true };
}

test('检查摘要按需展开并定位输入，两平台正文和私有保存保持真实', async ({ browser }, info) => {
  const { context, page, mobile } = await creatorContext(browser, info.project.name);
  try {
    await loginCreator(page);
    await page.goto('/dashboard/personas/new');
    await page.getByLabel('人设名称', { exact: true }).fill('有层次的星光书房');
    await page.getByLabel('一句话简介', { exact: true }).fill('折叠检查不会丢失输入');
    const personality = '  书房里的角色\n保留原始空白  ';
    await page.getByLabel('人格设定', { exact: true }).fill(personality);
    await page.getByRole('button', { name: 'AstrBot', exact: true }).click();
    await page.getByLabel('人格设定', { exact: true }).fill('AstrBot 的独立设定');
    await page.getByRole('button', { name: '添加一对对话', exact: true }).click();
    await page.getByLabel('对话 1 · 用户', { exact: true }).fill('你好，星光');
    await page.getByLabel('对话 1 · AI', { exact: true }).fill('我会记住这个故事');
    await page.getByRole('button', { name: 'MaiBot', exact: true }).click();
    await expect(page.getByLabel('人格设定', { exact: true })).toHaveValue(personality);

    const { surface, sheet } = await preview(page, mobile);
    const details = surface.getByRole('button', { name: '平台正文与对话 去完善', exact: true });
    await expect(details).toHaveCount(0);
    await expect(surface.getByRole('button', { name: '定位首个问题', exact: true })).toBeVisible();
    const expand = surface.getByRole('button', { name: '查看全部检查', exact: true });
    const bounds = await expand.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    if (mobile) await expand.tap();
    else {
      await expand.focus();
      await page.keyboard.press('Enter');
    }
    await expect(details).toBeVisible();
    await expect(
      surface.getByRole('button', { name: '收起检查清单', exact: true }),
    ).toHaveAttribute('aria-expanded', 'true');
    const title = surface.getByRole('button', { name: '作品名称与简介 已就绪', exact: true });
    await title.click();
    if (sheet) await expect(surface).toBeHidden();
    await expect(page.getByLabel('人设名称', { exact: true })).toBeFocused();
    await expect(page.getByLabel('一句话简介', { exact: true })).toHaveValue(
      '折叠检查不会丢失输入',
    );
    await page.getByRole('button', { name: 'AstrBot', exact: true }).click();
    await expect(page.getByLabel('人格设定', { exact: true })).toHaveValue('AstrBot 的独立设定');
    await expect(page.getByLabel('对话 1 · AI', { exact: true })).toHaveValue('我会记住这个故事');
    await page.getByRole('button', { name: 'MaiBot', exact: true }).click();
    await page.getByRole('button', { name: '创建私有草稿', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/personas\/[a-f0-9-]+\/edit$/);
    const id = new URL(page.url()).pathname.split('/').at(-2);
    const saved = DraftResponseSchema.parse(
      await (await page.request.get('/api/v1/me/personas/' + id + '/draft')).json(),
    );
    expect(saved.data.draft.content).toMatchObject({ personality });
    expect(saved.data.draft.summary).toBe('折叠检查不会丢失输入');
    expect((await page.request.get('/api/v1/personas/' + id)).status()).toBe(404);

    const editorPreview = await preview(page, mobile);
    await expect(
      editorPreview.surface.getByRole('heading', { name: '创作提示', exact: true }),
    ).toHaveCount(0);
    await editorPreview.surface.getByRole('button', { name: '查看全部检查', exact: true }).click();
    await expect(
      editorPreview.surface.getByRole('heading', { name: '创作提示', exact: true }),
    ).toBeVisible();
    await expect(editorPreview.surface).toContainText('正文会原样保存在服务器，空白内容也可以暂存');
    await editorPreview.surface.getByRole('button', { name: '收起检查清单', exact: true }).click();
    await expect(
      editorPreview.surface.getByRole('heading', { name: '创作提示', exact: true }),
    ).toHaveCount(0);
    if (editorPreview.sheet) await page.keyboard.press('Escape');
    await expect(page.getByLabel('人格设定', { exact: true })).toHaveValue(personality);
  } finally {
    await context.close();
  }
});

test('主要正文先于可选模型，大字标题和保存入口保持可读可达', async ({ browser }, info) => {
  const { context, page } = await creatorContext(browser, info.project.name);
  try {
    await page.goto('/dashboard/personas/new');
    await expect(page.getByLabel('人设名称', { exact: true })).toBeVisible();
    const content = page.locator('#persona-content');
    await expect(content).toBeVisible();
    expect(
      await content.evaluate((element) => {
        const models = document.getElementById('recommended-models');
        return Boolean(
          models && element.compareDocumentPosition(models) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
      }),
    ).toBe(true);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    const heading = page.getByRole('heading', { name: '创建人设', exact: true });
    const geometry = await heading.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
    }));
    expect(geometry.height).toBeLessThanOrEqual(geometry.lineHeight * 2 + 1);
    const save = page.getByRole('button', { name: '创建私有草稿', exact: true });
    await save.scrollIntoViewIfNeeded();
    await expect(save).toBeInViewport();
    const target = await save.boundingBox();
    expect(target?.height).toBeGreaterThanOrEqual(44);
    expect(target?.width).toBeGreaterThanOrEqual(44);
    expect(target?.height).toBeLessThanOrEqual(geometry.lineHeight * 2 + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
  } finally {
    await context.close();
  }
});
