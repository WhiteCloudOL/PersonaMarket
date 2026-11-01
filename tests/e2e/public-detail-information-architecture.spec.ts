import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { DraftResponseSchema, SubmissionResponseSchema } from '@personamarket/contracts';
import { browserWrite, loginCreator } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { visualPersonas } from '../fixtures/visual-personas.js';

test.use({ trace: 'off', screenshot: 'off' });
let authorContext: BrowserContext;
let reviewerContext: BrowserContext;
let guestContext: BrowserContext;
let author: Page;
let reviewer: Page;
let guest: Page;
let works: Awaited<ReturnType<typeof visualPersonas>>;
let touch = false;

test.beforeAll(async ({ browser }, info) => {
  const started = Date.now();
  const stage = (name: string) =>
    console.info(
      JSON.stringify({
        event: 'detail.fixture.stage',
        stage: name,
        elapsedMs: Date.now() - started,
      }),
    );
  stage('contexts_start');
  touch = info.project.name === 'mobile';
  const options = {
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    viewport: touch
      ? { width: 390, height: 844 }
      : info.project.name === 'tablet'
        ? { width: 768, height: 1024 }
        : { width: 1440, height: 900 },
    hasTouch: touch,
    isMobile: touch,
    reducedMotion: 'reduce' as const,
  };
  authorContext = await browser.newContext(options);
  reviewerContext = await browser.newContext(options);
  guestContext = await browser.newContext(options);
  author = await authorContext.newPage();
  reviewer = await reviewerContext.newPage();
  guest = await guestContext.newPage();
  stage('creator_login_start');
  await loginCreator(author);
  stage('admin_login_start');
  await loginBrowserAdmin(reviewer);
  stage('real_works_start');
  works = await visualPersonas(author, reviewer);
  stage('ready');
});

test.afterAll(async () => {
  try {
    if (works)
      for (const work of [works.maibot, works.astrbot]) {
        expect(
          (
            await browserWrite(author, '/api/v1/me/personas/' + work.id + '/visibility', {
              visibility: 'hidden',
              reason: '结束详情信息架构的隔离浏览器验收',
            })
          ).status(),
        ).toBe(200);
      }
  } finally {
    await authorContext?.close();
    await reviewerContext?.close();
    await guestContext?.close();
  }
});

test('介绍与正文分开阅读，模型说明和真实版本历史按需打开且保留焦点', async () => {
  for (const platform of ['maibot', 'astrbot'] as const) {
    await guest.goto('/personas/' + works[platform].id);
    const intro = guest.getByRole('tabpanel', { name: '作品介绍', exact: true });
    await expect(intro).toContainText('角色的故事');
    await expect(intro.getByRole('heading', { name: /人设结构/ })).toHaveCount(0);
    await expect(guest.getByRole('heading', { name: /人设结构/ })).toHaveCount(0);
    const sidebar = guest.getByRole('complementary', { name: '作品资料', exact: true });
    await expect(sidebar).toContainText('作者自选模型');
    await expect(sidebar.getByText('适合自然、细腻的日常对话', { exact: true })).toHaveCount(0);
    const modelTrigger = sidebar.getByRole('button', { name: '查看模型建议', exact: true });
    await modelTrigger.click();
    await expect(sidebar.getByText('适合自然、细腻的日常对话', { exact: true })).toBeVisible();
    await modelTrigger.click();
    await guest.getByRole('tab', { name: '人设内容', exact: true }).click();
    await expect(guest.getByRole('heading', { name: /人设结构/ })).toHaveCount(1);
    const url = guest.url();
    const trigger = guest.getByRole('button', { name: '查看版本记录', exact: true });
    expect((await trigger.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await expect(guest.getByRole('dialog', { name: '版本记录', exact: true })).toHaveCount(0);
    if (touch) await trigger.tap();
    else {
      await trigger.focus();
      await guest.keyboard.press('Enter');
    }
    const history = guest.getByRole('dialog', { name: '版本记录', exact: true });
    await expect(history).toBeVisible();
    const versionLink = history.getByRole('link', { name: /^v1\.0\.0/ });
    await expect(versionLink).toHaveCount(1);
    await versionLink.focus();
    await guest.keyboard.press('Space');
    expect(guest.url()).toBe(url);
    await expect(history).toBeVisible();
    if (!touch) {
      const popup = guestContext.waitForEvent('page');
      await versionLink.click({ modifiers: ['ControlOrMeta'] });
      const opened = await popup;
      await expect(opened).toHaveURL(new RegExp('/releases/' + works[platform].releaseId + '$'));
      await opened.close();
      await expect(history).toBeVisible();
    }
    await expect(history).toContainText('首次分享角色与使用建议');
    await expect(history.getByText('v1.1.0', { exact: true })).toHaveCount(0);
    await expect(history.locator('a[aria-current="page"]')).toHaveAttribute(
      'href',
      '/personas/' + works[platform].id + '/releases/' + works[platform].releaseId,
    );
    await guest.keyboard.press('Tab');
    expect(await history.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    await guest.keyboard.press('Escape');
    await expect(history).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(guest.getByRole('tab', { name: '人设内容', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(guest.url()).toBe(url);
    expect(await guest.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
  }
});

test('空介绍直接阅读正文，旧版介绍、历史锚点与未提交评论在面板切换时保留', async () => {
  const id = works.astrbot.id;
  const current = DraftResponseSchema.parse(
    await (await author.request.get('/api/v1/me/personas/' + id + '/draft')).json(),
  );
  const updated = await browserWrite(
    author,
    '/api/v1/me/personas/' + id + '/draft',
    {
      ...current.data.draft,
      readmeMarkdown: '',
      authorNotes: '',
    },
    'PUT',
    { 'If-Match': '"draft-' + current.meta.revision + '"' },
  );
  expect(updated.status()).toBe(200);
  const saved = DraftResponseSchema.parse(await updated.json());
  const submitted = await browserWrite(
    author,
    '/api/v1/me/personas/' + id + '/releases',
    {
      version: '1.0.1',
      changelog: '无作品介绍时直接阅读完整正文',
      expectedDraftRevision: saved.meta.revision,
      confirmed: true,
    },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(submitted.status()).toBe(200);
  const submission = SubmissionResponseSchema.parse(await submitted.json()).data;
  expect(
    (
      await browserWrite(
        reviewer,
        '/api/v1/admin/moderation/submissions/' + submission.id + '/review',
        {
          action: 'approve',
          expectedRevision: submission.revision,
          reason: '核对空介绍、完整正文与历史版本隔离',
          selfReviewConfirmed: false,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status(),
  ).toBe(200);
  await guest.goto('/personas/' + id);
  await expect(guest.getByRole('tab', { name: '作品介绍', exact: true })).toHaveCount(0);
  await expect(guest.getByRole('tab', { name: '人设内容', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(guest.getByRole('heading', { name: /人设结构/ })).toHaveCount(1);
  await guest.getByRole('button', { name: '查看版本记录', exact: true }).click();
  const history = guest.getByRole('dialog', { name: '版本记录', exact: true });
  await history
    .locator('a[href="/personas/' + id + '/releases/' + works.astrbot.releaseId + '"]')
    .click();
  await expect(guest).toHaveURL(new RegExp('/releases/' + works.astrbot.releaseId + '$'));
  await expect(history).toBeHidden();
  await expect(guest.getByRole('tabpanel', { name: '作品介绍', exact: true })).toContainText(
    '角色的故事',
  );
  await expect(guest.getByText('历史公开版本', { exact: true })).toBeVisible();

  await author.goto('/personas/' + works.maibot.id + '#release-history');
  const anchored = author.getByRole('dialog', { name: '版本记录', exact: true });
  await expect(anchored).toBeVisible();
  await anchored.getByRole('button', { name: '返回作品', exact: true }).click();
  await expect(anchored).toBeHidden();
  const input = author.getByRole('textbox', { name: '评论内容', exact: true });
  await input.fill('尚未提交的评论，在阅读正文和版本记录时保留');
  await author.getByRole('tab', { name: '来源与许可', exact: true }).click();
  const trigger = author.getByRole('button', { name: '查看版本记录', exact: true });
  await trigger.click();
  await author.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await expect(anchored).toBeVisible();
  expect(await author.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
    false,
  );
  const close = anchored.getByRole('button', { name: '返回作品', exact: true });
  await close.scrollIntoViewIfNeeded();
  await close.click();
  await expect(input).toHaveValue('尚未提交的评论，在阅读正文和版本记录时保留');
  const identityTitle = author.getByRole('heading', {
    name: works.maibot.title,
    exact: true,
    level: 1,
  });
  const titleBounds = await identityTitle.boundingBox();
  const lineHeight = await identityTitle.evaluate((node) =>
    Number.parseFloat(getComputedStyle(node).lineHeight),
  );
  expect(titleBounds?.width).toBeGreaterThanOrEqual(200);
  expect(titleBounds?.height).toBeLessThanOrEqual(lineHeight * 6);
  await author.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
});
