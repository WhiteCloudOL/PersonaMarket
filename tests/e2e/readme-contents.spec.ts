import { expect, test, type BrowserContext, type Dialog, type Page } from '@playwright/test';
import { loginCreator } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { publishedVisualPersonas } from '../fixtures/visual-personas.js';
import { longReadmeAppendix } from '../fixtures/readme-content.js';
import { randomUUID } from 'node:crypto';
import { DraftResponseSchema, SubmissionResponseSchema } from '@personamarket/contracts';
import { browserWrite } from '../fixtures/browser-account.js';
import { selectTheme } from '../fixtures/theme.js';

test.use({ trace: 'off', screenshot: 'off' });
let authorContext: BrowserContext;
let reviewerContext: BrowserContext;
let readerContext: BrowserContext;
let reader: Page;
let author: Page;
let reviewer: Page;
let works: Awaited<ReturnType<typeof publishedVisualPersonas>>;

test.beforeAll(async ({ browser }, info) => {
  const origin = process.env['PLAYWRIGHT_ORIGIN'];
  if (!origin) throw new Error('必须使用隔离测试站点');
  const options = {
    baseURL: origin,
    viewport:
      info.project.name === 'mobile'
        ? { width: 390, height: 844 }
        : info.project.name === 'tablet'
          ? { width: 768, height: 1024 }
          : { width: 1440, height: 900 },
    isMobile: info.project.name === 'mobile',
    hasTouch: info.project.name === 'mobile',
    reducedMotion: 'reduce' as const,
  };
  authorContext = await browser.newContext(options);
  reviewerContext = await browser.newContext(options);
  readerContext = await browser.newContext(options);
  author = await authorContext.newPage();
  reviewer = await reviewerContext.newPage();
  reader = await readerContext.newPage();
  await loginCreator(author);
  await loginBrowserAdmin(reviewer);
  works = await publishedVisualPersonas(author, reviewer, { readmeAppendix: longReadmeAppendix });
  const current = DraftResponseSchema.parse(
    await (await author.request.get('/api/v1/me/personas/' + works.maibot.id + '/draft')).json(),
  );
  const savedResponse = await browserWrite(
    author,
    '/api/v1/me/personas/' + works.maibot.id + '/draft',
    {
      ...current.data.draft,
      readmeMarkdown:
        current.data.draft.readmeMarkdown +
        '\n\n## PRIVATE_UNREVIEWED_SECTION\n\n不能出现在公开目录',
    },
    'PUT',
    { 'If-Match': '"draft-' + current.meta.revision + '"' },
  );
  expect(savedResponse.status()).toBe(200);
  const saved = DraftResponseSchema.parse(await savedResponse.json());
  expect(
    (
      await browserWrite(
        author,
        '/api/v1/me/personas/' + works.maibot.id + '/releases',
        {
          version: '1.1.0',
          changelog: '隔离测试未审核的新章节',
          expectedDraftRevision: saved.meta.revision,
          confirmed: true,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status(),
  ).toBe(200);
});

test.afterAll(async () => {
  await Promise.allSettled([
    authorContext?.close(),
    reviewerContext?.close(),
    readerContext?.close(),
  ]);
});

test('未水合时正文和稳定标题已可阅读，章节按钮禁用以免吞掉首次操作', async ({ browser }) => {
  const origin = process.env['PLAYWRIGHT_ORIGIN'];
  if (!origin) throw new Error('必须使用隔离测试站点');
  const context = await browser.newContext({ baseURL: origin });
  let release = () => {};
  const scriptsReady = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const page = await context.newPage();
    await page.route(/\/_next\/static\/.*\.js(?:\?|$)/, async (route) => {
      await scriptsReady;
      await route.continue();
    });
    const work = works.maibot;
    await page.goto('/personas/' + work.id + '/releases/' + work.releaseId, {
      waitUntil: 'commit',
    });
    await expect(page.getByRole('button', { name: '章节目录', exact: true })).toBeDisabled();
    await expect(page.locator('[id^="pm-readme-' + work.releaseId + '-"]')).toHaveCount(17);
    await expect(page.getByRole('heading', { name: '补充说明', exact: true })).toBeAttached();
    release();
    await page.waitForLoadState('load');
    await expect(page.getByRole('button', { name: '章节目录', exact: true })).toBeEnabled();
  } finally {
    release();
    await context.close();
  }
});

test('公开长文目录对应真实标题，重复标题独立定位且地址刷新后保持', async () => {
  for (const platform of ['maibot', 'astrbot'] as const) {
    const work = works[platform];
    await reader.goto('/personas/' + work.id);
    const trigger = reader.getByRole('button', { name: '章节目录', exact: true });
    await expect(trigger).toBeVisible();
    await expect(reader.getByRole('dialog', { name: '作品目录', exact: true })).toBeHidden();
    await trigger.click();
    const panel = reader.getByRole('dialog', { name: '作品目录', exact: true });
    await expect(panel).toBeVisible();
    const contents = panel.getByRole('navigation', { name: '作品目录', exact: true });
    const links = contents.getByRole('link');
    await expect(links).toHaveCount(17);
    await expect(contents).not.toContainText('PRIVATE_UNREVIEWED_SECTION');
    await expect(reader.locator('#main')).not.toContainText('PRIVATE_UNREVIEWED_SECTION');
    await expect(contents.getByRole('link', { name: '使用建议', exact: true })).toHaveCount(2);
    await expect(
      contents.getByRole('link', { name: '代码里的标题不应进入目录', exact: true }),
    ).toHaveCount(0);
    const hrefs = await links.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('href')),
    );
    expect(new Set(hrefs).size).toBe(17);
    const last = contents.getByRole('link', { name: '补充说明', exact: true });
    const href = await last.getAttribute('href');
    expect(href).toMatch(
      new RegExp(
        '^/personas/' +
          work.id +
          '/releases/' +
          work.releaseId +
          '#pm-readme-' +
          work.releaseId +
          '-\\d+$',
      ),
    );
    await last.click();
    await expect(panel).toBeHidden();
    const heading = reader.getByRole('heading', { name: '补充说明', exact: true });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
    await expect(trigger).toBeInViewport();
    const headingBox = await heading.boundingBox();
    const triggerBox = await trigger.boundingBox();
    expect(headingBox?.y).toBeGreaterThanOrEqual((triggerBox?.y ?? 0) + (triggerBox?.height ?? 0));
    expect(new URL(reader.url()).pathname + new URL(reader.url()).hash).toBe(href);
    await reader.reload();
    await expect(heading).toBeInViewport();
    await trigger.click();
    expect(
      await links.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('href')),
      ),
    ).toEqual(hrefs);
    await reader.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  }
});

test('章节抽屉在重点视口和深色大字下滚动、取消及触控定位均可用', async () => {
  const info = test.info();
  const work = works.maibot;
  await reader.goto('/personas/' + work.id + '/releases/' + work.releaseId);
  const sizes =
    info.project.name === 'mobile'
      ? [
          { width: 360, height: 800 },
          { width: 390, height: 500 },
          { width: 430, height: 932 },
        ]
      : info.project.name === 'tablet'
        ? [
            { width: 768, height: 1024 },
            { width: 1024, height: 768 },
          ]
        : [
            { width: 1366, height: 768 },
            { width: 1440, height: 900 },
            { width: 1920, height: 1080 },
            { width: 960, height: 800 },
          ];
  await selectTheme(reader, 'dark');
  const trigger = reader.getByRole('button', { name: '章节目录', exact: true });
  for (const viewport of sizes) {
    await reader.setViewportSize(viewport);
    await reader.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await trigger.click();
    const panel = reader.getByRole('dialog', { name: '作品目录', exact: true });
    const links = panel
      .getByRole('navigation', { name: '作品目录', exact: true })
      .getByRole('link');
    const navBox = await panel
      .getByRole('navigation', { name: '作品目录', exact: true })
      .boundingBox();
    const firstBox = await links.first().boundingBox();
    expect(firstBox?.y).toBeGreaterThanOrEqual((navBox?.y ?? 0) + 4);
    for (const link of await links.all()) {
      const box = await link.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }
    const last = links.last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    const box = await panel.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? Infinity)).toBeLessThanOrEqual(viewport.width + 0.5);
    await reader.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(await reader.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
  }
  await trigger.click();
  const chapter = reader
    .getByRole('navigation', { name: '作品目录', exact: true })
    .getByRole('link', { name: '第12章 · 一起收集日常的故事', exact: true });
  if (info.project.name === 'mobile') await chapter.tap();
  else {
    await chapter.focus();
    await reader.keyboard.press('Enter');
  }
  const target = reader.getByRole('heading', { name: '第12章 · 一起收集日常的故事', exact: true });
  await expect(target).toBeFocused();
  await expect(target).toBeInViewport();
  const targetBox = await target.boundingBox(),
    controlBox = await trigger.boundingBox();
  expect(targetBox?.y).toBeGreaterThanOrEqual((controlBox?.y ?? 0) + (controlBox?.height ?? 0));
  await reader.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
});

test('短文不展示多余目录，新公开短文不覆盖旧版本的完整章节', async () => {
  const work = works.astrbot;
  await reader.goto('/personas/' + work.id);
  await reader.getByRole('button', { name: '章节目录', exact: true }).click();
  await reader
    .getByRole('navigation', { name: '作品目录', exact: true })
    .getByRole('link', { name: '补充说明', exact: true })
    .click();
  await expect(reader.getByRole('dialog', { name: '作品目录', exact: true })).toBeHidden();
  const bookmark = reader.url();
  expect(new URL(bookmark).pathname).toBe('/personas/' + work.id + '/releases/' + work.releaseId);
  const current = DraftResponseSchema.parse(
    await (await author.request.get('/api/v1/me/personas/' + work.id + '/draft')).json(),
  );
  const savedResponse = await browserWrite(
    author,
    '/api/v1/me/personas/' + work.id + '/draft',
    { ...current.data.draft, readmeMarkdown: '# 短说明\n\n直接阅读这一段即可' },
    'PUT',
    { 'If-Match': '"draft-' + current.meta.revision + '"' },
  );
  expect(savedResponse.status()).toBe(200);
  const saved = DraftResponseSchema.parse(await savedResponse.json());
  const submittedResponse = await browserWrite(
    author,
    '/api/v1/me/personas/' + work.id + '/releases',
    {
      version: '1.1.0',
      changelog: '隔离测试简短作品介绍',
      expectedDraftRevision: saved.meta.revision,
      confirmed: true,
    },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(submittedResponse.status()).toBe(200);
  const submitted = SubmissionResponseSchema.parse(await submittedResponse.json());
  expect(
    (
      await browserWrite(
        reviewer,
        '/api/v1/admin/moderation/submissions/' + submitted.data.id + '/review',
        {
          action: 'approve',
          expectedRevision: submitted.data.revision,
          reason: '确认短文阅读和旧版本章节保留',
          selfReviewConfirmed: false,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status(),
  ).toBe(200);
  await reader.goto('/personas/' + work.id);
  await expect(reader.getByRole('heading', { name: '短说明', exact: true })).toBeVisible();
  await expect(reader.getByRole('button', { name: '章节目录', exact: true })).toHaveCount(0);
  await reader.goto(bookmark);
  await expect(reader.getByRole('heading', { name: '补充说明', exact: true })).toBeInViewport();
  const trigger = reader.getByRole('button', { name: '章节目录', exact: true });
  await trigger.click();
  await expect(
    reader.getByRole('navigation', { name: '作品目录', exact: true }).getByRole('link'),
  ).toHaveCount(17);
  await reader.keyboard.press('Escape');
});

test('从当前版选章规范化版本地址，保留评论筛选和未发送输入', async () => {
  const work = works.maibot;
  await author.goto('/personas/' + work.id + '?commentsPage=1');
  const input = author.getByLabel('评论内容', { exact: true });
  await expect(input).toBeEnabled();
  await input.fill('尚未发送的阅读体验，选择章节后继续编辑');
  await author.getByRole('button', { name: '章节目录', exact: true }).click();
  await author
    .getByRole('navigation', { name: '作品目录', exact: true })
    .getByRole('link', { name: '第12章 · 一起收集日常的故事', exact: true })
    .click();
  await expect(author.getByRole('dialog', { name: '作品目录', exact: true })).toBeHidden();
  expect(new URL(author.url()).pathname).toBe(
    '/personas/' + work.id + '/releases/' + work.releaseId,
  );
  expect(new URL(author.url()).searchParams.get('commentsPage')).toBe('1');
  await expect(input).toHaveValue('尚未发送的阅读体验，选择章节后继续编辑');
  const confirmations: string[] = [];
  const dismiss = async (dialog: Dialog) => {
    confirmations.push(dialog.message());
    await dialog.dismiss();
  };
  author.once('dialog', dismiss);
  try {
    await author
      .getByRole('navigation', { name: '面包屑', exact: true })
      .getByRole('link', { name: '探索人设', exact: true })
      .click();
    expect(confirmations).toEqual(['评论还有未提交的内容，确定离开吗']);
    expect(new URL(author.url()).pathname).toBe(
      '/personas/' + work.id + '/releases/' + work.releaseId,
    );
    await expect(input).toHaveValue('尚未发送的阅读体验，选择章节后继续编辑');
  } finally {
    author.off('dialog', dismiss);
  }
  await input.fill('');
});
