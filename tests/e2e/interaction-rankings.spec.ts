import { randomUUID } from 'node:crypto';
import { test as base, expect, type BrowserContext } from '@playwright/test';
import { RankingListResponseSchema } from '@personamarket/contracts';
import { browserWrite, loginCreator } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { publishedVisualPersonas } from '../fixtures/visual-personas.js';
import { rankingDatabase, refreshRanking } from '../fixtures/rankings.js';
import { seedSearchLoad } from '../fixtures/search-load.js';

const test = base.extend({
  page: async ({ browser }, use, info) => {
    const mobile = info.project.name === 'mobile';
    const viewport = mobile
      ? { width: 390, height: 844 }
      : info.project.name === 'tablet'
        ? { width: 768, height: 1024 }
        : { width: 1440, height: 900 };
    const context = await browser.newContext({
      baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
      viewport,
      isMobile: mobile,
      hasTouch: mobile,
      reducedMotion: 'reduce',
    });
    try {
      await use(await context.newPage());
    } finally {
      await context.close();
    }
  },
});

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });
let contexts: BrowserContext[] = [];
let works: Awaited<ReturnType<typeof publishedVisualPersonas>>;
test.beforeAll(async ({ browser }) => {
  const baseURL = process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100';
  contexts = await Promise.all(Array.from({ length: 3 }, () => browser.newContext({ baseURL })));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const owner = pages[0],
    admin = pages[1],
    reader = pages[2];
  if (!owner || !admin || !reader) throw Error('缺少隔离业务角色');
  await loginCreator(owner);
  await loginBrowserAdmin(admin);
  await loginCreator(reader);
  works = await publishedVisualPersonas(owner, admin);
  for (const [page, persona, kind] of [
    [owner, works.maibot, 'like'],
    [owner, works.maibot, 'favorite'],
    [reader, works.astrbot, 'like'],
    [reader, works.astrbot, 'favorite'],
  ] as const)
    expect(
      (await browserWrite(page, '/api/v1/personas/' + persona.id + '/' + kind, {}, 'PUT')).status(),
    ).toBe(200);
  const exported = await reader.request.get(
    '/api/v1/personas/' +
      works.maibot.id +
      '/releases/' +
      works.maibot.releaseId +
      '/export?format=text',
  );
  expect(exported.status()).toBe(200);
  await exported.body();
  await refreshRanking(reader);
});
test.afterAll(async () => {
  for (const context of contexts) await context.close();
});

test('六类真实榜单和适用窗口可触控切换，互动热度优先无导出作品，探索提供相同指标', async ({
  page,
}, info) => {
  await page.goto('/rankings');
  const kinds = page.getByRole('group', { name: '榜单类型选项', exact: true });
  await expect(kinds.getByRole('button')).toHaveCount(6);
  const list = page.getByRole('list', { name: '人设排名', exact: true });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list.getByRole('listitem').first()).toContainText(works.astrbot.title);
  await expect(list.getByRole('listitem').first()).toContainText('互动热度');
  if (info.project.name === 'mobile') {
    await expect(kinds.getByRole('button').first()).toBeEnabled();
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      const rowCounts = await kinds.getByRole('button').evaluateAll((buttons) => {
        const rows = new Map<number, number>();
        for (const button of buttons) {
          const top = Math.round(button.getBoundingClientRect().top);
          rows.set(top, (rows.get(top) ?? 0) + 1);
        }
        return [...rows.values()];
      });
      expect(
        Math.min(...rowCounts),
        `${width}px 默认字号不应留下孤立的榜单选项`,
      ).toBeGreaterThanOrEqual(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    const largeRows = await kinds
      .getByRole('button')
      .evaluateAll(
        (buttons) =>
          new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top))).size,
      );
    expect(largeRows, '大字布局应释放标签占用宽度，让六项榜单在三行内保持可读').toBeLessThanOrEqual(
      3,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
  }
  for (const kind of ['点赞', '收藏']) {
    const target = kinds.getByRole('button', { name: kind, exact: true });
    await expect(target).toBeEnabled();
    const box = await target.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
    if (info.project.name === 'mobile') await target.tap();
    else await target.click();
    await expect(target).toHaveAttribute('aria-pressed', 'true');
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list).toContainText(works.astrbot.title);
    await expect(list).toContainText('有效' + kind + ' 1');
    for (const name of ['近 30 天', '全部时间', '近 7 天']) {
      const window = page
        .getByRole('group', { name: '统计范围选项', exact: true })
        .getByRole('button', { name, exact: true });
      await window.click();
      await expect(window).toHaveAttribute('aria-pressed', 'true');
      await expect(list.getByRole('listitem')).toHaveCount(1);
    }
  }
  await page.goto('/explore?sort=hot');
  const cards = page.locator('main article');
  await expect(cards.first()).toContainText(works.astrbot.title);
  await expect(cards.first()).toContainText('互动热度');
  await page.getByRole('button', { name: '统计说明', exact: true }).click();
  const rules = page.getByRole('dialog', { name: '热度和导出如何计算', exact: true });
  await expect(rules).toContainText('有效点赞×3、收藏×4、导出×1');
  await expect(rules).toContainText('取消重加保留首次时间');
  await rules.getByRole('button', { name: '返回探索', exact: true }).click();
  await expect(page.getByRole('button', { name: '统计说明', exact: true })).toBeFocused();
  for (const [sort, label] of [
    ['likes', '有效点赞'],
    ['favorites', '有效收藏'],
  ] as const) {
    const control = page.getByRole('combobox', { name: '结果排序', exact: true });
    await control.click();
    const option = page.getByRole('option', { name: label, exact: true });
    if (info.project.name === 'mobile') await option.tap();
    else await option.click();
    await expect(page).toHaveURL(new RegExp('sort=' + sort));
    await expect(page.getByRole('combobox', { name: '结果排序', exact: true })).toContainText(
      label,
    );
    await expect(page.locator('main article').first()).toContainText(works.astrbot.title);
    await expect(page.locator('main article').first()).toContainText(label + ' 1');
  }
});

test('旧队列生成的导出快照显示真实旧版口径，切换互动类型清除旧批次并回到新版', async ({ page }) => {
  const database = rankingDatabase(),
    id = randomUUID();
  try {
    await database.db.transaction(async (tx) => {
      const { sql } = await import('drizzle-orm');
      await tx.execute(
        sql`INSERT INTO ranking_generations(id,request_key,algorithm) VALUES(${id}::uuid,${'legacy-browser:' + id},'exports-v1')`,
      );
      await tx.execute(
        sql`INSERT INTO outbox_events(topic,payload) VALUES('rankings.refresh',${JSON.stringify({ generationId: id })}::jsonb)`,
      );
    });
  } finally {
    await database.close();
  }
  await expect
    .poll(
      async () => {
        const response = await page.request.get('/api/v1/rankings?snapshotId=' + id);
        return response.status() === 200
          ? RankingListResponseSchema.parse(await response.json()).meta.algorithm
          : null;
      },
      { timeout: 5000 },
    )
    .toBe('exports-v1');
  await page.goto('/rankings?snapshotId=' + id);
  await expect(page.getByText('旧版快照', { exact: true })).toBeVisible();
  const list = page.getByRole('list', { name: '人设排名', exact: true });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText('导出热度');
  await expect(list).toContainText(works.maibot.title);
  await page
    .getByRole('group', { name: '榜单类型选项', exact: true })
    .getByRole('button', { name: '点赞', exact: true })
    .click();
  await expect(page).toHaveURL(/kind=likes/);
  expect(new URL(page.url()).searchParams.has('snapshotId')).toBe(false);
  await expect(list).toContainText(works.astrbot.title);
  await expect(list).toContainText('有效点赞 1');
});

test('客户端脚本尚未接管时筛选明确禁用，加载完成后的首次操作生效', async ({ page }) => {
  for (const targetPage of ['rankings', 'explore'] as const) {
    let release = () => {};
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pattern = '**/_next/static/chunks/**';
    await page.route(pattern, async (route) => {
      if (route.request().resourceType() === 'script') await ready;
      await route.continue();
    });
    try {
      await page.goto(
        targetPage === 'rankings' ? '/rankings?kind=downloads&window=all' : '/explore?sort=hot',
        { waitUntil: 'commit' },
      );
      const pausedTarget =
        targetPage === 'rankings'
          ? page
              .getByRole('group', { name: '榜单类型选项', exact: true, includeHidden: true })
              .getByRole('button', { name: '收藏', exact: true, includeHidden: true })
          : page.getByRole('combobox', { name: '结果排序', exact: true, includeHidden: true });
      // Next流式段在脚本恢复前可能仍隐藏，直接核验服务端已输出的禁用状态
      // 探索为PC/手机各保留一个排序控件，暂停脚本时同时检查两个SSR分支
      await expect(pausedTarget).toHaveCount(targetPage === 'rankings' ? 1 : 2);
      for (let index = 0; index < (await pausedTarget.count()); index++)
        await expect(pausedTarget.nth(index)).toBeDisabled();
      await expect(
        page.getByRole('button', { name: '统计说明', exact: true, includeHidden: true }),
      ).toBeDisabled();
      release();
      const target =
        targetPage === 'rankings'
          ? page
              .getByRole('group', { name: '榜单类型选项', exact: true })
              .getByRole('button', { name: '收藏', exact: true })
          : page.getByRole('combobox', { name: '结果排序', exact: true });
      await expect(target).toBeEnabled();
      await expect(page.getByRole('button', { name: '统计说明', exact: true })).toBeEnabled();
      await target.click();
      if (targetPage === 'rankings') {
        await expect(target).toHaveAttribute('aria-pressed', 'true');
        await expect(page).toHaveURL(/kind=favorites/);
        await expect(page.getByRole('list', { name: '人设排名', exact: true })).toContainText(
          works.astrbot.title,
        );
      } else {
        await page.getByRole('option', { name: '有效点赞', exact: true }).click();
        await expect(page).toHaveURL(/sort=likes/);
        await expect(page.locator('main article').first()).toContainText(works.astrbot.title);
      }
    } finally {
      release();
      await page.unrouteAll({ behavior: 'wait' });
    }
  }
});

test('登录读者浏览20条排名只批量读取一次私有互动状态，全部行可操作且不产生逐卡请求', async ({
  page,
}) => {
  const database = rankingDatabase(),
    client = await database.pool.connect();
  try {
    await seedSearchLoad(client, works.maibot.id, 21);
  } finally {
    client.release();
    await database.close();
  }
  const reader = contexts[2];
  if (!reader) throw Error('缺少真实已验证读者');
  await page.context().addCookies(await reader.cookies());
  await refreshRanking(page);
  const requests: URL[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/me/persona-interactions') requests.push(url);
  });
  await page.goto('/rankings?kind=new');
  await expect(
    page.getByRole('list', { name: '人设排名', exact: true }).getByRole('listitem'),
  ).toHaveCount(20);
  await expect(page.getByText('正在读取互动状态…', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '取消点赞', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '重试互动状态', exact: true })).toHaveCount(0);
  expect(requests).toHaveLength(1);
  expect(new Set(requests[0]?.searchParams.get('ids')?.split(',')).size).toBe(20);
});
