import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createDatabase } from '@personamarket/database';
import { createSystemQueue } from '@personamarket/server';
import { e2eQueueName } from '../../scripts/e2e-queue.js';
import { AdminOverviewResponseSchema } from '@personamarket/contracts';
import { browserWrite, loginCreator } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { publishedVisualPersonas } from '../fixtures/visual-personas.js';
import { selectTheme } from '../fixtures/theme.js';

test.use({ trace: 'off', screenshot: 'off' });
let adminContext: BrowserContext, authorContext: BrowserContext, moderatorContext: BrowserContext;
let admin: Page, author: Page, moderator: Page, touch: boolean;
let probeQueue: ReturnType<typeof createSystemQueue> | undefined;
let probeId: string | undefined;
test.beforeAll(async ({ browser }, info) => {
  touch = info.project.name === 'mobile';
  const options = {
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    viewport: touch
      ? { width: 390, height: 844 }
      : info.project.name === 'tablet'
        ? { width: 768, height: 1024 }
        : { width: 1440, height: 900 },
    isMobile: touch,
    hasTouch: touch,
    reducedMotion: 'reduce' as const,
  };
  adminContext = await browser.newContext(options);
  authorContext = await browser.newContext(options);
  moderatorContext = await browser.newContext(options);
  admin = await adminContext.newPage();
  author = await authorContext.newPage();
  moderator = await moderatorContext.newPage();
  await loginBrowserAdmin(admin);
  await loginCreator(author);
  const credentials = await loginCreator(moderator);
  const works = await publishedVisualPersonas(author, admin);
  expect(
    (
      await browserWrite(moderator, '/api/v1/personas/' + works.maibot.id + '/like', {}, 'PUT')
    ).status(),
  ).toBe(200);
  expect(
    (
      await browserWrite(
        moderator,
        '/api/v1/personas/' + works.maibot.id + '/comments',
        { body: '受控浏览器验收的待审评论' },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status(),
  ).toBe(200);
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test')) throw Error('只允许隔离库');
  const db = createDatabase(source);
  try {
    await db.pool.query("UPDATE users SET role='moderator' WHERE username=$1", [
      credentials.username,
    ]);
  } finally {
    await db.close();
  }
  await moderator.goto('/login');
  await moderator.getByLabel('用户名或邮箱').fill(credentials.username);
  await moderator.getByLabel('密码', { exact: true }).fill(credentials.password);
  await moderator.getByRole('button', { name: '登录', exact: true }).click();
  await expect(moderator).toHaveURL(/\/account$/);
});
test.afterAll(async () => {
  if (probeId) await (await probeQueue?.getJob(probeId))?.remove();
  await probeQueue?.close();
  await moderatorContext?.close();
  await authorContext?.close();
  await adminContext?.close();
});
async function activate(page: Page, name: string) {
  const control = page.getByRole('button', { name, exact: true });
  if (touch) await control.tap();
  else {
    await control.focus();
    await page.keyboard.press('Enter');
  }
}

test('概览只观察当前隔离Worker队列，真实失败不会读取成主站空队列', async () => {
  const databaseUrl = process.env['TEST_DATABASE_URL'],
    redisUrl = process.env['REDIS_URL'];
  if (!databaseUrl || !redisUrl) throw Error('缺少隔离队列配置');
  probeQueue = createSystemQueue(redisUrl, e2eQueueName(databaseUrl));
  await probeQueue.waitUntilReady();
  const job = await probeQueue.add(
    'unsupported.fixture',
    { schemaVersion: 1, eventId: randomUUID() },
    { attempts: 1, jobId: randomUUID() },
  );
  probeId = job.id;
  await expect.poll(async () => (await probeQueue?.getJobCounts('failed'))?.['failed']).toBe(1);
  const response = await admin.request.get('/api/v1/admin/overview');
  expect(response.status()).toBe(200);
  const { data } = AdminOverviewResponseSchema.parse(await response.json());
  if (data.role !== 'admin') throw Error('缺少管理员统计');
  expect(data.observations.queue).toMatchObject({ status: 'ready', failed: 1 });
});

test('管理员读取真实发布和待审数据，队列入口直达既有功能', async () => {
  await admin.goto('/admin');
  await expect(admin).toHaveURL(/\/admin$/);
  await expect(admin.getByRole('heading', { name: '等待处理', exact: true })).toBeVisible();
  const response = await admin.request.get('/api/v1/admin/overview');
  expect(response.status()).toBe(200);
  const { data } = AdminOverviewResponseSchema.parse(await response.json());
  if (data.role !== 'admin') throw Error('缺少管理员统计');
  expect(data.catalog.publicPersonas).toBe(2);
  expect(data.interactions.likes7d).toBe(1);
  expect(data.interactions.comments7d).toBe(0);
  expect(data.queues.comments).toBe(1);
  const queues = admin.getByRole('navigation', { name: '待处理队列' });
  await expect(queues.getByRole('link')).toHaveCount(4);
  await queues.getByRole('link', { name: /^评论/ }).click();
  await expect(admin).toHaveURL(/\/admin\/comments$/);
  await admin.goto('/admin');
  await expect(admin.getByRole('button', { name: '刷新概览', exact: true })).toBeEnabled();
  await activate(admin, '刷新概览');
  await expect(admin.getByText('已读取最新统计', { exact: true })).toBeVisible();
});

test('统计口径和运行详情按需展开，键盘触控及焦点恢复可用', async () => {
  await admin.goto('/admin');
  await expect(admin.getByRole('dialog')).toHaveCount(0);
  await activate(admin, '统计口径');
  const dialog = admin.getByRole('dialog', { name: '统计口径', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('连续 168 小时');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(admin.getByRole('button', { name: '统计口径', exact: true })).toBeFocused();
  await activate(admin, '查看运行详情');
  const details = admin.getByRole('dialog', { name: '运行详情', exact: true });
  await expect(details).toBeVisible();
  await expect(details).toContainText('数量不能相加');
  await details
    .getByText('仅统计配置存储目录内的普通文件', { exact: false })
    .scrollIntoViewIfNeeded();
  await expect(details.getByRole('heading', { name: '私有文件采样', exact: true })).toBeVisible();
  await admin.keyboard.press('Escape');
  await expect(admin.getByRole('button', { name: '查看运行详情', exact: true })).toBeFocused();
});

test('审核员只看到获授权队列，普通用户和匿名状态不能读管理统计', async () => {
  await moderator.goto('/admin');
  await expect(moderator.getByRole('heading', { name: '等待处理', exact: true })).toBeVisible();
  await expect(
    moderator.getByRole('navigation', { name: '待处理队列' }).getByRole('link'),
  ).toHaveCount(3);
  await expect(moderator.getByRole('heading', { name: '站点近况', exact: true })).toHaveCount(0);
  await expect(moderator.getByRole('heading', { name: '运行观测', exact: true })).toHaveCount(0);
  await author.goto('/admin');
  await expect(author.getByText('你没有管理概览权限', { exact: true })).toBeVisible();
  expect((await author.request.get('/api/v1/admin/overview')).status()).toBe(403);
  const anonymous = await adminContext
    .browser()
    ?.newContext({ baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100' });
  if (!anonymous) throw Error('缺少独立匿名上下文');
  try {
    expect((await anonymous.request.get('/api/v1/admin/overview')).status()).toBe(401);
  } finally {
    await anonymous.close();
  }
});

test('请求失败可原地重试，手机大字与深色保持队列可操作且不横溢出', async () => {
  const pattern = '**/api/v1/admin/overview';
  await admin.route(pattern, (route) => route.abort('failed'));
  await admin.goto('/admin');
  await expect(admin.getByRole('button', { name: '重新读取概览', exact: true })).toBeVisible();
  await admin.unroute(pattern);
  await activate(admin, '重新读取概览');
  await expect(admin.getByRole('heading', { name: '等待处理', exact: true })).toBeVisible();
  await selectTheme(admin, 'dark');
  const original = admin.viewportSize();
  if (!original) throw Error('缺少视口');
  for (const width of [360, 390, 430]) {
    await admin.setViewportSize({ width, height: 844 });
    await admin.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    expect(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    for (const link of await admin
      .getByRole('navigation', { name: '待处理队列' })
      .getByRole('link')
      .all()) {
      const box = await link.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }
    for (const label of ['人设版本', '评论', '公开资料', '举报']) {
      const title = admin
        .getByRole('navigation', { name: '待处理队列' })
        .getByText(label, { exact: true });
      const rows = await title.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size;
      });
      expect(rows, label + '在大字下应完整横排').toBeLessThanOrEqual(1);
    }
  }
  await admin.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
  await admin.setViewportSize(original);
  await selectTheme(admin, 'system');
});

test('直接打开和刷新概览时首次骨架一致，不产生水合警告或脚本错误', async () => {
  const failures: string[] = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    const document = await adminContext.newPage();
    document.on('pageerror', (error) => failures.push(error.message));
    document.on('console', (message) => {
      if (/hydrat|server rendered HTML/iu.test(message.text())) failures.push(message.text());
    });
    try {
      await document.goto('/admin');
      await expect(document.getByRole('heading', { name: '等待处理', exact: true })).toBeVisible();
      await document.reload();
      await expect(document.getByRole('heading', { name: '等待处理', exact: true })).toBeVisible();
    } finally {
      await document.close();
    }
  }
  expect(failures).toEqual([]);
});
