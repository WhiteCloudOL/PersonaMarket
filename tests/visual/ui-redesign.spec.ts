import { selectTheme } from '../fixtures/theme.js';
import { accountNavigationItem, closeAccountNavigation } from '../fixtures/account-navigation.js';
import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type TestInfo,
  type Locator,
} from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { loginCreator, browserWrite } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { visualPersonas } from '../fixtures/visual-personas.js';
import { CommentResponseSchema, PublicStatisticsResponseSchema } from '@personamarket/contracts';
import { randomUUID } from 'node:crypto';
import { refreshRanking } from '../fixtures/rankings.js';

const phase = process.env['UI_CAPTURE_PHASE'] === 'baseline' ? 'baseline' : 'current';
const coreOnly = process.env['UI_CAPTURE_MATRIX'] === 'core';
const root = process.cwd();
const directory = join(root, 'data/tests/ui-redesign', phase);
test.use({ actionTimeout: 10000 });
function viewportOf(info: TestInfo) {
  const size = info.project.use.viewport;
  if (!size) throw new Error('视觉测试必须指定真实视口');
  return size;
}
type Actor = 'guest' | 'author' | 'admin';
type Scene = { key: string; url: string; actor: Actor; ready?: string; field?: string };
type State = Awaited<ReturnType<BrowserContext['storageState']>>;
const states = new Map<Actor, State>();
function actorState(actor: Actor) {
  const state = states.get(actor);
  if (!state) throw new Error('视觉测试角色尚未完成真实登录');
  return state;
}
const setupContexts: BrowserContext[] = [];
async function touch(target: Locator) {
  const bounds = await target.boundingBox();
  if (!bounds) throw new Error('触控目标不可见');
  expect(bounds.width).toBeGreaterThanOrEqual(44);
  expect(bounds.height).toBeGreaterThanOrEqual(44);
  await target.tap();
}
let scenes: Scene[] = [];
let commentPersonaId: string;
let visualReplyBody: string;
const records: Array<{
  page: string;
  viewport: string;
  theme: string;
  file: string;
  overflow: boolean;
  headerHeight: number;
  headerOverflow: boolean;
  rootFontSize: number;
  fontFamily: string;
  brokenImages: number;
}> = [];

async function capture(page: Page, scene: Scene, viewport: string, theme = 'light') {
  await page.goto(scene.url);
  const main = scene.key === 'not-found' ? page.locator('body') : page.locator('#main');
  await expect(main).toBeVisible();
  try {
    if (scene.field) await expect(main.getByLabel(scene.field, { exact: true })).toBeVisible();
    else if (scene.ready)
      await expect(main.getByText(scene.ready, { exact: true }).first()).toBeVisible();
    else await expect(main.getByRole('heading').first()).toBeVisible();
    if (scene.key === 'comments-public')
      await expect(main.getByText(visualReplyBody, { exact: true })).toBeVisible();
    if (scene.key === 'comments-review')
      await expect(
        page
          .getByRole('dialog', { name: '评论审核详情', exact: true })
          .getByLabel('审核或处置理由', { exact: true }),
      ).toBeVisible();
    if (['create', 'maibot-editor', 'astrbot-editor'].includes(scene.key))
      await expect(main.getByRole('textbox', { name: 'Markdown 介绍', exact: true })).toBeVisible();
  } catch (cause) {
    await mkdir(join(directory, viewport), { recursive: true });
    await page.screenshot({
      path: join(directory, viewport, scene.key + '-failed.png'),
      fullPage: true,
      mask: [page.getByText(/^[^\s]+@fixture\.invalid$/)],
    });
    if (scene.key === 'home-empty') {
      const api = await page.request.get('/api/v1/personas');
      await writeFile(
        join(directory, viewport, 'home-empty-diagnostic.json'),
        JSON.stringify(
          { main: await main.innerText(), apiStatus: api.status(), api: await api.json() },
          null,
          2,
        ),
      );
    }
    throw cause;
  }
  await captureCurrent(page, scene.key, viewport, theme);
  if (['home', 'home-authenticated'].includes(scene.key)) {
    const response = await page.request.get('/api/v1/public/statistics');
    expect(response.ok()).toBe(true);
    const statistics = PublicStatisticsResponseSchema.parse(await response.json()).data;
    const region = page.getByRole('region', { name: '社区统计' });
    for (const key of ['personas', 'creators', 'exports'] as const)
      await expect(region.getByTestId('stat-' + key)).toHaveText(
        new Intl.NumberFormat('zh-CN').format(statistics[key]),
      );
  }
}

async function captureCurrent(
  page: Page,
  key: string,
  viewport: string,
  theme = 'light',
  fullPage = true,
) {
  if (fullPage) await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images]
        .filter((img) => img.loading !== 'lazy')
        .map((img) => img.decode().catch(() => undefined)),
    );
  });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            [...document.images]
              .filter((img) => {
                const bounds = img.getBoundingClientRect();
                return bounds.top < innerHeight && bounds.bottom > 0 && bounds.width > 0;
              })
              .filter((img) => !img.complete).length,
        ),
      { message: key + ' 首屏图片应完成加载' },
    )
    .toBe(0);
  // 字号变化后的容器查询要经过布局帧，截图也必须覆盖实际文档高度
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  const measurements = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    headerHeight: document.querySelector('header')?.getBoundingClientRect().height ?? 0,
    headerOverflow: (() => {
      const header = document.querySelector('[data-site-header]');
      return header ? header.scrollWidth > header.clientWidth : false;
    })(),
    rootFontSize: parseFloat(getComputedStyle(document.documentElement).fontSize),
    fontFamily: getComputedStyle(document.body).fontFamily,
    brokenImages: [...document.images].filter((img) => {
      const bounds = img.getBoundingClientRect();
      return (
        bounds.width > 0 &&
        bounds.height > 0 &&
        bounds.bottom > 0 &&
        bounds.top < innerHeight &&
        img.complete &&
        img.naturalWidth === 0
      );
    }).length,
  }));
  const filename = join(directory, viewport, key + '-' + theme + '.png');
  await mkdir(join(directory, viewport), { recursive: true });
  const captures: Array<{ before: number; png: number; after: number }> = [];
  let covered = !fullPage;
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await page.evaluate(
      () => document.documentElement.scrollHeight * devicePixelRatio,
    );
    await page.screenshot({
      path: filename,
      fullPage,
      mask: [page.getByText(/^[^\s]+@fixture\.invalid$/)],
    });
    if (!fullPage) break;
    const png = await readFile(filename);
    const after = await page.evaluate(
      () => document.documentElement.scrollHeight * devicePixelRatio,
    );
    captures.push({ before, png: png.readUInt32BE(20), after });
    covered =
      Math.abs(png.readUInt32BE(20) - Math.round(after)) <= 2 && Math.abs(before - after) <= 1;
    if (covered) break;
    // 异步内容在截图期间改变高度时重新捕获，最多三次且最终尺寸仍须严格一致
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
  }
  if (captures.length > 1)
    await writeFile(
      filename.replace(/\.png$/, '-capture-heights.json'),
      JSON.stringify(captures, null, 2),
    );
  expect(covered, key + ' 截图应覆盖稳定的整个文档').toBe(true);
  records.push({
    page: key,
    viewport,
    theme,
    file: relative(root, filename).replaceAll('\\', '/'),
    ...measurements,
  });
  if (phase === 'current') {
    expect.soft(measurements.overflow, key + ' 不应整页横向溢出').toBe(false);
    expect
      .soft(measurements.headerHeight, key + ' 顶栏应保持单行')
      .toBeLessThanOrEqual((88 * measurements.rootFontSize) / 16);
    expect.soft(measurements.headerOverflow, key + ' 顶栏内容不应溢出').toBe(false);
    expect.soft(measurements.brokenImages, key + ' 首屏图片应加载成功').toBe(0);
  }
}

test.beforeAll(async ({ browser }, info) => {
  const baseURL = process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100';
  const authorContext = await browser.newContext({ baseURL });
  const adminContext = await browser.newContext({ baseURL });
  setupContexts.push(authorContext, adminContext);
  const author = await authorContext.newPage();
  const admin = await adminContext.newPage();
  const account = await loginCreator(author);
  await loginBrowserAdmin(admin);
  states.set('author', await authorContext.storageState());
  states.set('admin', await adminContext.storageState());
  states.set('guest', { cookies: [], origins: [] });
  for (const size of [viewportOf(info)]) {
    const context = await browser.newContext({
      baseURL,
      viewport: size,
      storageState: actorState('author'),
      reducedMotion: 'reduce',
      isMobile: size.width < 640,
      hasTouch: size.width < 1024,
    });
    try {
      const page = await context.newPage();
      for (const scene of [
        {
          key: 'home-empty',
          url: '/',
          actor: 'author' as const,
          ready: '第一个角色，等你来写',
        },
        {
          key: 'explore-empty',
          url: '/explore',
          actor: 'author' as const,
          ready: '暂无公开作品',
        },
        {
          key: 'workspace-empty',
          url: '/dashboard/personas',
          actor: 'author' as const,
          ready: '为你的第一个角色写下性格',
        },
      ])
        await capture(page, scene, size.width + 'x' + size.height);
    } finally {
      await context.close();
    }
  }
  const personas = await visualPersonas(author, admin);
  commentPersonaId = personas.maibot.id;
  const publicBody =
    '收到角色的温柔回应，分享一次真实的使用体验\n' +
    'https://example.invalid/'.repeat(12) +
    '\n保留换行，长内容在不同屏幕上自然阅读'.repeat(12);
  visualReplyBody = '在同一楼层继续交流角色的表达习惯\n' + '星光与旅途的创作故事'.repeat(25);
  const pendingBody =
    '仅作者与审核人员可见的待审文字\n' + '长中文与LongUnbrokenModelName'.repeat(20);
  async function createComment(body: string, parentId?: string, approved = false) {
    const response = await browserWrite(
      author,
      '/api/v1/personas/' + commentPersonaId + '/comments',
      {
        body,
        releaseId: personas.maibot.releaseId,
        ...(parentId ? { parentId, replyToId: parentId } : {}),
      },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(response.status()).toBe(200);
    const row = CommentResponseSchema.parse(await response.json()).data;
    if (approved)
      expect(
        (
          await browserWrite(
            admin,
            '/api/v1/admin/comments/' + row.id + '/review',
            {
              revisionId: row.latest.id,
              expectedRevision: row.revision,
              decision: 'approve',
              reason: '核验隔离视觉样本',
            },
            'POST',
            { 'Idempotency-Key': randomUUID() },
          )
        ).status(),
      ).toBe(200);
    return row;
  }
  const publicComment = await createComment(publicBody, undefined, true);
  await createComment(visualReplyBody, publicComment.id, true);
  const pendingComment = await createComment(pendingBody);
  await createComment('另一个需要人工核对的评论\n' + '自然换行与二级楼层体验'.repeat(20));
  await refreshRanking(author);
  // 建立第二个真实设备会话，验证摘要与多设备布局，凭据只保存在当前测试内存
  const phone = await browser.newContext({
    baseURL,
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36',
  });
  try {
    const phonePage = await phone.newPage();
    expect(
      (
        await browserWrite(phonePage, '/api/v1/auth/login', {
          identifier: account.username,
          password: account.password,
        })
      ).status(),
    ).toBe(200);
  } finally {
    await phone.close();
  }
  scenes = [
    { key: 'home', url: '/', actor: 'guest', ready: personas.maibot.title },
    { key: 'home-authenticated', url: '/', actor: 'author', ready: personas.maibot.title },
    { key: 'explore', url: '/explore', actor: 'guest', ready: personas.maibot.title },
    {
      key: 'rankings',
      url: '/rankings?kind=new&platform=all&window=30d',
      actor: 'guest',
      ready: personas.maibot.title,
    },
    {
      key: 'maibot-detail',
      url: '/personas/' + personas.maibot.id,
      actor: 'guest',
      ready: personas.maibot.title,
    },
    {
      key: 'astrbot-detail',
      url: '/personas/' + personas.astrbot.id,
      actor: 'guest',
      ready: personas.astrbot.title,
    },
    {
      key: 'history',
      url: '/personas/' + personas.maibot.id + '/releases/' + personas.maibot.releaseId,
      actor: 'guest',
      ready: personas.maibot.title,
    },
    { key: 'workspace', url: '/dashboard/personas', actor: 'author', ready: personas.maibot.title },
    { key: 'create', url: '/dashboard/personas/new', actor: 'author', field: '人设名称' },
    {
      key: 'maibot-editor',
      url: '/dashboard/personas/' + personas.maibot.id + '/edit',
      actor: 'author',
      field: '人格设定',
    },
    {
      key: 'astrbot-editor',
      url: '/dashboard/personas/' + personas.astrbot.id + '/edit',
      actor: 'author',
      field: '对话 3 · AI',
    },
    {
      key: 'versions',
      url: '/dashboard/personas/' + personas.maibot.id + '/releases',
      actor: 'author',
      ready: '审核或操作意见：请补充更清晰的角色使用建议',
    },
    { key: 'moderation', url: '/admin/moderation', actor: 'admin', ready: personas.maibot.title },
    {
      key: 'review',
      url: '/admin/moderation?submission=' + personas.pendingId,
      actor: 'admin',
      field: '审核意见',
    },
    { key: 'settings-brand', url: '/admin/settings/brand', actor: 'admin', field: '站点名称' },
    { key: 'settings-mail', url: '/admin/settings/mail', actor: 'admin' },
    { key: 'settings-accounts', url: '/admin/settings/accounts', actor: 'admin' },
    {
      key: 'settings-creation',
      url: '/admin/settings/creation',
      actor: 'admin',
      field: '每人每日投稿次数',
    },
    { key: 'account', url: '/account', actor: 'author', ready: account.username },
    { key: 'account-security', url: '/account?tab=security', actor: 'author', field: '新密码' },
    { key: 'account-mfa', url: '/account?tab=mfa', actor: 'author', ready: '开始绑定身份验证器' },
    { key: 'account-site', url: '/account?tab=site', actor: 'admin', field: '站点名称' },
    { key: 'import', url: '/dashboard/personas/import', actor: 'author' },
    { key: 'login', url: '/login', actor: 'guest', field: '用户名或邮箱' },
    { key: 'register', url: '/register', actor: 'guest', field: '用户名' },
    { key: 'forgot-password', url: '/forgot-password', actor: 'guest' },
    { key: 'reset-password', url: '/reset-password', actor: 'guest' },
    { key: 'verify-email', url: '/verify-email', actor: 'guest' },
    { key: 'change-email', url: '/change-email', actor: 'guest' },
    { key: 'mfa', url: '/mfa?setup=1', actor: 'author', ready: '开始绑定身份验证器' },
    { key: 'guides', url: '/guides', actor: 'guest' },
    { key: 'not-found', url: '/missing-ui-review-page', actor: 'guest' },
    {
      key: 'comments-public',
      url: '/personas/' + commentPersonaId + '?replyThread=' + publicComment.id + '#comments',
      actor: 'guest',
      ready: publicBody,
    },
    {
      key: 'comments-owner',
      url: '/personas/' + commentPersonaId + '#my-comments',
      actor: 'author',
      ready: pendingBody,
    },
    {
      key: 'comments-moderation',
      url: '/admin/comments?personaId=' + commentPersonaId,
      actor: 'admin',
      ready: pendingBody,
    },
    {
      key: 'comments-review',
      url: '/admin/comments?personaId=' + commentPersonaId + '&commentId=' + pendingComment.id,
      actor: 'admin',
      ready: pendingBody,
    },
    {
      key: 'settings-community',
      url: '/admin/settings/community',
      actor: 'admin',
      field: '单条评论字数上限',
    },
  ];
});

test.afterAll(async ({ browser }, info) => {
  try {
    await mkdir(join(root, '.development/evidence/ui-redesign', phase), { recursive: true });
    await writeFile(
      join(root, '.development/evidence/ui-redesign', phase, info.project.name + '.json'),
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          phase,
          matrix: coreOnly ? 'core' : 'all',
          browserConnected: browser.isConnected(),
          records,
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    for (const context of setupContexts) await context.close();
  }
});

test('评论批量审核的键盘、触控、深色、大字与短视口', async ({ browser }, info) => {
  const size = viewportOf(info);
  const viewport = size.width + 'x' + size.height;
  const context = await browser.newContext({
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    viewport: size,
    storageState: actorState('admin'),
    reducedMotion: 'reduce',
    isMobile: size.width < 640,
    hasTouch: size.width < 1024,
  });
  try {
    const page = await context.newPage();
    await page.goto('/admin/comments?personaId=' + commentPersonaId);
    const checkboxes = page.getByRole('checkbox', { name: '选择当前文本', exact: true });
    await expect(checkboxes).toHaveCount(2);
    await checkboxes.first().focus();
    await page.keyboard.press('Space');
    await expect(checkboxes.first()).toBeChecked();
    await checkboxes.last().check();
    const open = page.getByRole('button', { name: '批量审核所选评论', exact: true });
    await open.focus();
    await page.keyboard.press('Enter');
    const panel = page.getByRole('dialog', { name: '批量审核评论', exact: true });
    await expect(panel.getByLabel('批量审核理由', { exact: true })).toBeVisible();
    await captureCurrent(page, 'comments-bulk', viewport, 'light', false);
    const close = panel.getByRole('button', { name: '关闭', exact: true });
    const closeSize = await close.boundingBox();
    expect(closeSize?.width).toBeGreaterThanOrEqual(44);
    expect(closeSize?.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(open).toBeFocused();
    await selectTheme(page, 'dark');
    await expect(page.locator('html')).toHaveClass('dark');
    await open.click();
    await expect(panel.getByLabel('批量审核理由', { exact: true })).toBeVisible();
    await captureCurrent(page, 'comments-bulk', viewport, 'dark', false);
    const reason = panel.getByLabel('批量审核理由', { exact: true });
    const text = '保留人工核对理由，长中文与英文连续字符 '.repeat(12) + 'LongModel'.repeat(20);
    await reason.fill(text);
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.keyboard.press('Escape');
    await expect(panel).toBeVisible();
    await expect(reason).toHaveValue(text);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '32px';
    });
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await reason.focus();
    await reason.scrollIntoViewIfNeeded();
    const largeEditor = await reason.boundingBox();
    expect(largeEditor?.height).toBeLessThanOrEqual((await page.evaluate(() => innerHeight)) / 2);
    await expect(reason).toBeInViewport({ ratio: 1 });
    await expect(reason).toHaveValue(text);
    await captureCurrent(page, 'comments-bulk-large-text-200', viewport, 'dark', false);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
    if (size.width < 640) {
      await page.setViewportSize({ width: size.width, height: 390 });
      await reason.focus();
      await reason.scrollIntoViewIfNeeded();
      const visible = await reason.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return Math.min(bounds.bottom, innerHeight) - Math.max(bounds.top, 0);
      });
      expect(visible).toBeGreaterThanOrEqual(44);
      const shortEditor = await reason.boundingBox();
      expect(shortEditor?.height).toBeLessThanOrEqual((await page.evaluate(() => innerHeight)) / 2);
      await expect(reason).toBeInViewport({ ratio: 1 });
      await expect(reason).toHaveValue(text);
      const submit = panel.getByRole('button', { name: '核对并处理 2 条评论', exact: true });
      await submit.focus();
      await submit.scrollIntoViewIfNeeded();
      await expect(submit).toBeInViewport({ ratio: 1 });
      await reason.focus();
      await reason.scrollIntoViewIfNeeded();
      await captureCurrent(
        page,
        'comments-bulk-short-viewport',
        size.width + 'x390',
        'dark',
        false,
      );
      await page.setViewportSize(size);
    }
    page.once('dialog', (dialog) => dialog.accept());
    await close.click();
    await expect(panel).toBeHidden();
    await expect(open).toBeFocused();
    const reviewScene = scenes.find((scene) => scene.key === 'comments-review');
    if (!reviewScene) throw new Error('缺少单条审核场景');
    await page.goto(reviewScene.url);
    const detail = page.getByRole('dialog', { name: '评论审核详情', exact: true });
    const detailReason = detail.getByLabel('审核或处置理由', { exact: true });
    await detailReason.fill(text);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '32px';
    });
    await detailReason.focus();
    await detailReason.scrollIntoViewIfNeeded();
    const detailEditor = await detailReason.boundingBox();
    expect(detailEditor?.height).toBeLessThanOrEqual((await page.evaluate(() => innerHeight)) / 2);
    await expect(detailReason).toBeInViewport({ ratio: 1 });
    await expect(detailReason).toHaveValue(text);
    await captureCurrent(page, 'comments-review-large-editor-200', viewport, 'dark', false);
  } finally {
    await context.close();
  }
});

test('逐页真实截图与布局', async ({ browser }, info) => {
  const size = viewportOf(info);
  test.setTimeout(180000); // 每个视口串行浏览29个真实页面并保存完整截图，非单个操作超时
  const contexts = new Map<Actor, BrowserContext>();
  try {
    for (const actor of ['guest', 'author', 'admin'] as const)
      contexts.set(
        actor,
        await browser.newContext({
          baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
          viewport: size,
          storageState: actorState(actor),
          reducedMotion: 'reduce',
          isMobile: size.width < 640,
          hasTouch: size.width < 1024,
        }),
      );
    const pages = new Map<Actor, Page>();
    for (const [actor, context] of contexts) pages.set(actor, await context.newPage());
    for (const scene of scenes) {
      const page = pages.get(scene.actor);
      if (!page) throw new Error('缺少角色浏览器');
      await test.step(scene.key, async () => capture(page, scene, size.width + 'x' + size.height));
    }
    if (phase === 'current') {
      const guest = pages.get('guest');
      const author = pages.get('author');
      const admin = pages.get('admin');
      if (!guest || !author || !admin) throw new Error('缺少交互测试角色');
      const viewport = size.width + 'x' + size.height;
      await guest.clock.install();
      if (size.width < 1024) {
        await guest.goto('/');
        const navigation = guest.getByRole('button', { name: '打开导航', exact: true });
        await touch(navigation);
        await guest.screenshot({
          path: join(directory, size.width + 'x' + size.height, 'navigation-touch.png'),
          fullPage: false,
        });
        await guest
          .getByRole('navigation', { name: '移动端主导航' })
          .getByRole('link', { name: '探索', exact: true })
          .tap();
        await expect(guest).toHaveURL(/\/explore$/);
        await expect(guest.getByRole('dialog')).toBeHidden();
        await touch(navigation);
        await guest.keyboard.press('Escape');
        await expect(navigation).toBeFocused();
        await guest.goto('/explore');
        const filters = guest.getByRole('button', { name: '筛选人设' });
        await touch(filters);
        await touch(guest.getByRole('combobox', { name: '推荐模型筛选' }));
        await guest.getByRole('option', { name: '作者自选模型', exact: true }).tap();
        await expect(guest).not.toHaveURL(/model=/);
        await guest.screenshot({
          path: join(directory, size.width + 'x' + size.height, 'filters-touch.png'),
          fullPage: false,
        });
        await guest.keyboard.press('Escape');
        await expect(filters).toBeFocused();
        await touch(filters);
        await expect(guest.getByRole('combobox', { name: '推荐模型筛选' })).toContainText('全部');
        await touch(guest.getByRole('combobox', { name: '推荐模型筛选' }));
        await guest.getByRole('option', { name: '作者自选模型', exact: true }).tap();
        await touch(guest.getByRole('button', { name: '查看结果', exact: true }));
        await expect(guest).toHaveURL(/model=/);
        await expect(guest.getByRole('group', { name: '人设筛选与排序' })).toHaveAttribute(
          'aria-busy',
          'false',
        );
        await guest.goBack();
        await expect(guest).not.toHaveURL(/model=/);
      }
      await author.goto('/account');
      await expect(await accountNavigationItem(author, '创作工作台')).toBeVisible();
      await expect(
        author
          .getByRole('menuitem', { name: '站点设置', exact: true })
          .or(author.getByRole('link', { name: '站点设置', exact: true })),
      ).toHaveCount(0);
      await captureCurrent(author, 'account-menu', viewport, 'light', false);
      await closeAccountNavigation(author);
      await expect(author.getByText('Chrome · Android', { exact: true })).toBeVisible();
      const rawAgent = author.getByText(/Mozilla\/5\.0/).first();
      await expect(rawAgent).toBeHidden();
      await author.locator('summary').first().click();
      await expect(rawAgent).toBeVisible();
      if ([390, 1024, 1440].includes(size.width)) {
        for (const actor of ['guest', 'author', 'admin'] as const) {
          const page = pages.get(actor);
          if (!page) throw new Error('缺少主题检查角色');
          await page.goto('/');
          await selectTheme(page, 'dark');
          await expect(page.locator('html')).toHaveClass('dark');
        }
        for (const scene of scenes.filter((item) =>
          [
            'home',
            'explore',
            'rankings',
            'maibot-detail',
            'astrbot-detail',
            'create',
            'maibot-editor',
            'account',
            'settings-brand',
            'review',
            'comments-public',
            'comments-owner',
            'comments-moderation',
            'comments-review',
            'settings-community',
            'login',
          ].includes(item.key),
        )) {
          const page = pages.get(scene.actor);
          if (!page) throw new Error('缺少主题检查角色');
          await capture(page, scene, viewport, 'dark');
        }
        await selectTheme(author, 'light');
        const editor = scenes.find((scene) => scene.key === 'maibot-editor');
        if (!editor) throw new Error('缺少编辑器检查场景');
        await author.goto(editor.url);
        const name = author.getByLabel('人设名称', { exact: true });
        const personality = author.getByLabel('人格设定', { exact: true });
        const model = author.getByLabel('模型 1 · 标识', { exact: true });
        const original = {
          name: await name.inputValue(),
          personality: await personality.inputValue(),
          model: await model.inputValue(),
        };
        await name.fill('星光图书馆_' + 'LongCharacterName'.repeat(4));
        await personality.fill('在漫长的故事中保持细腻、温柔与清晰的表达\n'.repeat(55));
        await model.fill('LongModelIdentifier-' + 'abcdefgh'.repeat(6));
        await author.getByRole('button', { name: '保存草稿', exact: true }).click();
        await expect(author.getByText('已保存到服务器', { exact: true })).toBeVisible();
        await captureCurrent(author, 'editor-long-content', viewport);
        await author
          .getByRole('button', { name: '预览', exact: true })
          .isVisible()
          .then(async (visible) => {
            if (!visible) return;
            await author.getByRole('button', { name: '预览', exact: true }).click();
            await expect(author.getByRole('dialog', { name: '发布预览' })).toBeVisible();
            await captureCurrent(author, 'editor-preview-touch', viewport, 'light', false);
            await author.keyboard.press('Escape');
            await expect(author.getByRole('button', { name: '预览', exact: true })).toBeFocused();
          });
        await name.fill(original.name);
        await personality.fill(original.personality);
        await model.fill(original.model);
        await author.getByRole('button', { name: '保存草稿', exact: true }).click();
        await expect(author.getByText('已保存到服务器', { exact: true })).toBeVisible();
        const releaseButton = author.getByRole('button', { name: '创建 Release', exact: true });
        await releaseButton.click();
        await expect(
          author.getByRole('dialog', { name: '确认本次发版', exact: true }),
        ).toBeVisible();
        const confirmationSize = await author
          .getByRole('dialog', { name: '确认本次发版', exact: true })
          .boundingBox();
        if (!confirmationSize) throw new Error('发版确认面板不可见');
        expect(confirmationSize.width).toBeGreaterThanOrEqual(
          size.width < 640 ? size.width - 2 : 720,
        );
        await captureCurrent(author, 'release-confirmation', viewport, 'light', false);
        await author.keyboard.press('Escape');
        await expect(releaseButton).toBeFocused();
        if (size.width < 640) {
          await author.setViewportSize({ width: size.width, height: 390 });
          await personality.focus();
          await personality.scrollIntoViewIfNeeded();
          const visibleHeight = await personality.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            return Math.min(bounds.bottom, innerHeight) - Math.max(bounds.top, 160);
          });
          expect(visibleHeight).toBeGreaterThan(80);
          await captureCurrent(
            author,
            'editor-keyboard-viewport',
            size.width + 'x390',
            'light',
            false,
          );
          await author.setViewportSize(size);
          await admin.goto('/admin/settings/brand');
          const brandName = admin.getByLabel('站点名称', { exact: true });
          const savedBrandName = await brandName.inputValue();
          await brandName.fill(savedBrandName + ' · 未保存');
          const settings = admin.getByRole('button', { name: '选择设置分组' });
          await settings.click();
          await expect(admin.getByRole('dialog', { name: '网站设置', exact: true })).toBeVisible();
          await captureCurrent(admin, 'settings-navigation-touch', viewport, 'dark', false);
          admin.once('dialog', (dialog) => dialog.dismiss());
          await admin.getByRole('link', { name: '邮件服务 SMTP', exact: true }).tap();
          await expect(admin).toHaveURL(/\/settings\/brand$/);
          await expect(admin.getByRole('dialog', { name: '网站设置', exact: true })).toBeVisible();
          await expect(brandName).toHaveValue(savedBrandName + ' · 未保存');
          await admin.keyboard.press('Escape');
          await expect(settings).toBeFocused();
          await brandName.fill(savedBrandName);
          await touch(settings);
          await admin.getByRole('link', { name: '邮件服务 SMTP', exact: true }).tap();
          await expect(admin).toHaveURL(/\/settings\/mail$/);
          await expect(admin.getByRole('dialog')).toBeHidden();
        }
        await guest.goto('/');
        await selectTheme(guest, 'light');
        await guest.route('**/api/v1/public/config', (route) => route.abort('failed'));
        await guest.clock.fastForward(31_000);
        await guest.evaluate(() => window.dispatchEvent(new Event('offline')));
        await guest.evaluate(() => window.dispatchEvent(new Event('online')));
        const brandAlert = guest.getByRole('region', { name: '站点介绍' }).getByRole('alert');
        await expect(brandAlert).toContainText('站点介绍暂时无法更新');
        await captureCurrent(guest, 'home-network-error', viewport);
        await guest.unroute('**/api/v1/public/config');
        await guest.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
        await expect(brandAlert).toHaveCount(0);
        // 仅注入失败与挂起状态，成功结果仍由真实 API/PostgreSQL 返回
        let allowSessions: () => void = () => {
          throw new Error('会话请求尚未挂起');
        };
        const sessionsGate = new Promise<void>((resolve) => {
          allowSessions = resolve;
        });
        await author.route('**/api/v1/auth/sessions', async (route) => {
          await sessionsGate;
          await route.continue();
        });
        const resumedSessions = author.waitForResponse(
          (response) =>
            response.url().endsWith('/api/v1/auth/sessions') &&
            response.request().method() === 'GET',
        );
        try {
          await author.goto('/account');
          await expect(author.getByText('正在读取设备…', { exact: true })).toBeVisible();
          await captureCurrent(author, 'account-loading', viewport);
        } finally {
          allowSessions();
          await resumedSessions;
          await author.unrouteAll({ behavior: 'wait' });
        }
        await expect(author.getByText('Chrome · Android', { exact: true })).toBeVisible();
        await author.route('**/api/v1/auth/sessions', (route) => route.abort('failed'));
        await author.reload();
        await expect(author.getByText('无法读取设备会话', { exact: true })).toBeVisible();
        await captureCurrent(author, 'account-network-error', viewport);
        await author.unroute('**/api/v1/auth/sessions');
        await author.getByRole('button', { name: '重试', exact: true }).click();
        await expect(author.getByText('Chrome · Android', { exact: true })).toBeVisible();
        await guest.goto('/admin/settings/brand');
        await expect(guest.getByText('此页面需要管理员权限', { exact: true })).toBeVisible();
        await captureCurrent(guest, 'settings-no-permission', viewport);
        await guest.goto('/account');
        await expect(
          guest.getByRole('link', { name: '登录后管理账号', exact: true }),
        ).toBeVisible();
        await captureCurrent(guest, 'account-login-required', viewport);
        await guest.goto('/');
        await expect(guest.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(
          guest.getByRole('region', { name: '社区统计' }).getByTestId('stat-personas'),
        ).toBeVisible();
        const homeScene = scenes.find((scene) => scene.key === 'home');
        if (!homeScene?.ready) throw new Error('缺少首页真实作品');
        await expect(
          guest.locator('#main').getByText(homeScene.ready, { exact: true }).first(),
        ).toBeVisible();
        await guest.evaluate(() => {
          document.documentElement.style.fontSize = '20px';
        });
        await captureCurrent(guest, 'home-large-text', viewport);
        await guest.evaluate(() => {
          document.documentElement.style.fontSize = '32px';
        });
        await captureCurrent(guest, 'home-statistics-large-text-200', viewport);
        const homeLargeLayout = await guest.evaluate(() => {
          const rect = (element: Element | null) => {
            if (!element) return null;
            const box = element.getBoundingClientRect();
            return { x: box.x, y: box.y, width: box.width, height: box.height, bottom: box.bottom };
          };
          return {
            scrollHeight: document.documentElement.scrollHeight,
            body: rect(document.body),
            hero: rect(document.querySelector('section[aria-label="站点介绍"]')),
            footer: rect(document.querySelector('footer')),
            cards: [...document.querySelectorAll('main a [data-slot="card-title"]')].map(
              (element) => ({
                title: element.textContent,
                titleBounds: rect(element),
                link: rect(element.closest('a')),
              }),
            ),
          };
        });
        await writeFile(
          join(directory, viewport, 'home-large-layout.json'),
          JSON.stringify(homeLargeLayout, null, 2),
        );
        expect(homeLargeLayout.cards.length).toBeGreaterThan(0);
        for (const card of homeLargeLayout.cards) expect(card.link?.height).toBeGreaterThan(0);
        expect(homeLargeLayout.footer?.bottom).toBeGreaterThan(homeLargeLayout.hero?.bottom ?? 0);
        expect(homeLargeLayout.scrollHeight).toBeGreaterThanOrEqual(
          (homeLargeLayout.footer?.bottom ?? 0) - 1,
        );
        const clippedHomeText = await guest.evaluate(() => {
          const targets = document.querySelectorAll('main a');
          const clipped: string[] = [];
          for (const target of targets) {
            const box = (target.closest('a') ?? target).getBoundingClientRect();
            const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              if (!node.textContent?.trim()) continue;
              const range = document.createRange();
              range.selectNodeContents(node);
              if (
                [...range.getClientRects()].some(
                  (text) => text.x < box.x - 1 || text.right > box.right + 1,
                )
              )
                clipped.push(node.textContent.trim());
            }
          }
          return clipped;
        });
        expect(clippedHomeText, '大字模式首页按钮和作品标题不能被裁切').toEqual([]);
        const statisticsBounds = await guest
          .getByRole('region', { name: '社区统计' })
          .boundingBox();
        if (!statisticsBounds) throw new Error('统计区不可见');
        for (const key of ['personas', 'creators', 'exports'] as const) {
          const box = await guest.getByTestId('stat-' + key).boundingBox();
          if (!box) throw new Error('统计值不可见');
          expect(box.x).toBeGreaterThanOrEqual(statisticsBounds.x - 1);
          expect(box.x + box.width).toBeLessThanOrEqual(
            statisticsBounds.x + statisticsBounds.width + 1,
          );
        }
        await guest.evaluate(() => {
          document.documentElement.style.fontSize = '';
        });
        if (size.width === 1440) {
          // 1440px物理屏幕在200%缩放下的有效布局为720px，桌面浏览器仿真此布局范围
          await guest.setViewportSize({ width: 720, height: 450 });
          await captureCurrent(guest, 'home-zoom-200-layout', '720x450', 'light', false);
          await guest.setViewportSize(size);
        }
      }
      if (size.width === 1024) {
        await guest.setViewportSize({ width: 960, height: 900 });
        for (const scene of scenes.filter((item) =>
          ['home', 'explore', 'rankings'].includes(item.key),
        ))
          await capture(guest, scene, '960x900');
        await guest.setViewportSize(size);
      }
      if ([390, 1024, 1440].includes(size.width)) {
        await guest.goto('/explore?q=' + encodeURIComponent('星河'.repeat(40)));
        await expect(guest.getByText('没有找到匹配的人设', { exact: true })).toBeVisible();
        await guest.evaluate(() => {
          document.documentElement.style.fontSize = '32px';
        });
        await captureCurrent(guest, 'explore-large-text-200', viewport);
        const filterArea = guest.getByRole('group', { name: '人设筛选与排序', exact: true });
        const filterBounds = await filterArea.boundingBox();
        if (!filterBounds) throw new Error('缺少筛选区边界');
        for (const control of [
          ...(await filterArea.getByRole('button').all()),
          ...(await filterArea.getByRole('combobox').all()),
        ]) {
          const bounds = await control.boundingBox();
          if (!bounds) continue;
          expect(bounds.x).toBeGreaterThanOrEqual(filterBounds.x - 1);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(
            filterBounds.x + filterBounds.width + 1,
          );
        }
        for (const button of await guest
          .getByRole('group', { name: '人设平台', exact: true })
          .getByRole('button')
          .all()) {
          const dimensions = await button.evaluate((element) => ({
            scroll: element.scrollWidth,
            client: element.clientWidth,
          }));
          expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
        }
        if (size.width < 1024) {
          const trigger = guest.getByRole('button', { name: '筛选人设', exact: true });
          await touch(trigger);
          await captureCurrent(guest, 'explore-filters-large-text-200', viewport, 'light', false);
          await guest.keyboard.press('Escape');
          await expect(trigger).toBeFocused();
        } else {
          await guest.getByRole('button', { name: /^高级筛选/ }).click();
          await captureCurrent(guest, 'explore-filters-large-text-200', viewport);
        }
        await guest.evaluate(() => {
          document.documentElement.style.fontSize = '';
        });
        for (const [key, query] of [
          ['token', 'model'.repeat(16)],
          ['url', ('https://example.invalid/' + 'a'.repeat(80)).slice(0, 80)],
        ] as const) {
          await guest.goto('/explore?q=' + encodeURIComponent(query));
          await expect(guest.getByText('没有找到匹配的人设', { exact: true })).toBeVisible();
          await guest.evaluate(() => {
            document.documentElement.style.fontSize = '32px';
          });
          await captureCurrent(guest, 'explore-long-' + key + '-large-text-200', viewport);
          await guest.evaluate(() => {
            document.documentElement.style.fontSize = '';
          });
        }
      }
    }
  } finally {
    for (const context of contexts.values()) await context.close();
  }
});
