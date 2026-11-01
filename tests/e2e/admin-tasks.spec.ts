import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { AdminTaskListResponseSchema, AssetJobResponseSchema } from '@personamarket/contracts';
import { createDatabase } from '@personamarket/database';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { browserWrite, loginCreator } from '../fixtures/browser-account.js';
import { selectTheme } from '../fixtures/theme.js';

test.use({ trace: 'off', screenshot: 'off' });
let context: BrowserContext, admin: Page, touch: boolean;
test.beforeAll(async ({ browser }, info) => {
  const origin = process.env['PLAYWRIGHT_ORIGIN'];
  if (!origin) throw Error('缺少隔离测试站点地址');
  touch = info.project.name === 'mobile';
  context = await browser.newContext({
    baseURL: origin,
    viewport: touch
      ? { width: 390, height: 844 }
      : info.project.name === 'tablet'
        ? { width: 768, height: 1024 }
        : { width: 1440, height: 900 },
    isMobile: touch,
    hasTouch: touch,
    reducedMotion: 'reduce',
  });
  admin = await context.newPage();
  await loginBrowserAdmin(admin);
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test')) throw Error('只接受隔离数据库');
  const database = createDatabase(source);
  try {
    for (const suffix of ['cover', 'readme']) {
      const url = 'https://localhost/admin-task-e2e-' + suffix + '.png';
      const previous = (
        await database.pool.query<{ status: string }>(
          'SELECT status FROM asset_jobs WHERE source_url=$1',
          [url],
        )
      ).rows;
      // Playwright失败后会重启worker；只复用本文件已通过业务API生成的隔离样本
      if (previous.length) {
        expect(previous).toEqual([{ status: 'failed' }]);
        continue;
      }
      const response = await browserWrite(admin, '/api/v1/me/assets/import-url', { url });
      expect(response.status()).toBe(200);
      const id = AssetJobResponseSchema.parse(await response.json()).data.id;
      await expect
        .poll(
          async () =>
            AssetJobResponseSchema.parse(
              await (await context.request.get('/api/v1/me/asset-jobs/' + id)).json(),
            ).data.status,
        )
        .toBe('failed');
    }
  } finally {
    await database.close();
  }
});
test.afterAll(async () => {
  await context?.close();
});
async function activate(name: string) {
  const control = admin.getByRole('button', { name, exact: true });
  if (touch) await control.tap();
  else {
    await control.focus();
    await admin.keyboard.press('Enter');
  }
}

test('真实Worker拒绝内网图片后，概览入口与失败任务列表使用实际业务终态', async () => {
  await admin.goto('/admin');
  const link = admin.getByRole('link', { name: '查看失败任务', exact: true });
  await expect(link).toHaveAttribute('href', '/admin/tasks');
  if (touch) await link.tap();
  else await link.click();
  await expect(admin).toHaveURL(/\/admin\/tasks$/u);
  await expect(
    admin.getByRole('heading', { level: 1, name: '失败任务', exact: true }),
  ).toBeVisible();
  await expect(admin.getByRole('heading', { name: '在线图片导入', exact: true })).toHaveCount(2);
  const response = await context.request.get('/api/v1/admin/tasks?category=images');
  expect(response.status()).toBe(200);
  const body = AdminTaskListResponseSchema.parse(await response.json());
  expect(body.meta.total).toBe(2);
  expect(
    body.data.every(
      (row) =>
        row.source === 'image' && row.stage === 'execution' && row.executionAttempts === null,
    ),
  ).toBe(true);
});

test('筛选Sheet取消保留原条件，应用后URL、刷新和返回保持真实筛选', async () => {
  await admin.goto('/admin/tasks');
  await admin.getByRole('combobox', { name: '任务类别', exact: true }).click();
  await admin.getByRole('option', { name: '邮件', exact: true }).click();
  await expect(admin).toHaveURL(/category=mail/u);
  await expect(admin.getByText('当前没有符合条件的失败任务', { exact: true })).toBeVisible();
  await activate('按阶段筛选');
  const sheet = admin.getByRole('dialog', { name: '按阶段筛选', exact: true });
  await sheet.getByRole('button', { name: '执行失败', exact: true }).click();
  await sheet.getByRole('button', { name: '取消', exact: true }).click();
  await expect(sheet).toBeHidden();
  expect(new URL(admin.url()).searchParams.has('stage')).toBe(false);
  await activate('按阶段筛选');
  await expect(sheet.getByRole('button', { name: '全部阶段', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await sheet.getByRole('button', { name: '执行失败', exact: true }).click();
  await sheet.getByRole('button', { name: '应用筛选', exact: true }).click();
  await expect(admin).toHaveURL(/stage=execution/u);
  await expect(admin.getByRole('button', { name: '阶段筛选 · 1', exact: true })).toBeFocused();
  await admin.reload();
  await expect(admin.getByText('当前没有符合条件的失败任务', { exact: true })).toBeVisible();
  await admin.getByRole('combobox', { name: '任务类别', exact: true }).click();
  await admin.getByRole('option', { name: '图片导入', exact: true }).click();
  await expect(admin.getByRole('heading', { name: '在线图片导入', exact: true })).toHaveCount(2);
  await admin.goBack();
  await expect(admin).toHaveURL(/category=mail/u);
  await expect(admin.getByText('当前没有符合条件的失败任务', { exact: true })).toBeVisible();
});

test('任务详情按需展开，真实次数不混用，键盘和触控关闭后恢复焦点', async () => {
  await admin.goto('/admin/tasks');
  const trigger = admin.getByRole('button', { name: '查看在线图片导入详情', exact: true }).first();
  await expect(trigger).toBeVisible();
  if (touch) await trigger.tap();
  else {
    await trigger.focus();
    await admin.keyboard.press('Enter');
  }
  const dialog = admin.getByRole('dialog', { name: '在线图片导入', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '任务信息', exact: true }).click();
  await expect(dialog.getByText('未记录', { exact: true })).toBeVisible();
  await expect(dialog.getByText('IMAGE_IMPORT_FAILED', { exact: true })).toBeVisible();
  expect(await dialog.textContent()).not.toContain('https://localhost/');
  if (touch) await dialog.getByRole('button', { name: '关闭', exact: true }).tap();
  else await admin.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(await admin.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('真实网络错误可原地重读，窄屏、大字与深色保持阅读和触控空间', async () => {
  await admin.route('**/api/v1/admin/tasks*', (route) => route.abort('failed'));
  try {
    await admin.goto('/admin/tasks');
    await expect(admin.getByRole('button', { name: '重新读取任务', exact: true })).toBeVisible();
  } finally {
    await admin.unroute('**/api/v1/admin/tasks*');
  }
  await activate('重新读取任务');
  await expect(admin.getByRole('heading', { name: '在线图片导入', exact: true })).toHaveCount(2);
  if (touch) {
    for (const width of [360, 390, 430]) {
      await admin.setViewportSize({ width, height: 844 });
      expect(await admin.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
    }
    await admin.setViewportSize({ width: 390, height: 844 });
    await admin.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    expect(await admin.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    for (const button of await admin
      .getByRole('button', { name: '查看在线图片导入详情', exact: true })
      .all()) {
      const box = await button.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }
    await admin.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
  }
  await selectTheme(admin, 'dark');
  await expect(admin.locator('html')).toHaveClass(/dark/u);
  await expect(admin.getByRole('heading', { name: '在线图片导入', exact: true })).toHaveCount(2);
  await selectTheme(admin, 'light');
});

test('已有结果的刷新失败必须报告本次读取未完成，不能沿用成功提示', async () => {
  await admin.goto('/admin/tasks');
  await expect(admin.getByRole('heading', { name: '在线图片导入', exact: true })).toHaveCount(2);
  await expect(admin.getByRole('status').filter({ hasText: '已读取' })).toBeVisible();
  await admin.route('**/api/v1/admin/tasks*', (route) => route.abort('failed'));
  try {
    await activate('刷新列表');
    await expect(admin.getByRole('button', { name: '重新读取任务', exact: true })).toBeVisible();
    await expect(admin.getByRole('status').filter({ hasText: '本次读取未完成' })).toBeVisible();
    await expect(admin.getByText('已读取最新状态', { exact: true })).toHaveCount(0);
  } finally {
    await admin.unroute('**/api/v1/admin/tasks*');
  }
  await activate('重新读取任务');
  await expect(admin.getByRole('heading', { name: '在线图片导入', exact: true })).toHaveCount(2);
});

test('匿名与普通账号的页面和直接API都不能读取任务', async ({ page }) => {
  await page.goto('/admin/tasks');
  await expect(page.getByText('请先登录', { exact: true })).toBeVisible();
  expect((await page.request.get('/api/v1/admin/tasks')).status()).toBe(401);
  await loginCreator(page);
  await page.goto('/admin/tasks');
  await expect(page.getByText('你没有任务运维权限', { exact: true })).toBeVisible();
  expect((await page.request.get('/api/v1/admin/tasks')).status()).toBe(403);
  await expect(page.getByText('在线图片导入', { exact: true })).toHaveCount(0);
});

test('直接打开任务页和刷新时不产生hydration或其他未捕获脚本错误', async () => {
  const errors: string[] = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    const document = await context.newPage();
    document.on('pageerror', (error) => errors.push(error.message));
    document.on('console', (message) => {
      if (/hydrat|server rendered HTML/iu.test(message.text())) errors.push(message.text());
    });
    try {
      await document.goto('/admin/tasks');
      await expect(
        document.getByRole('heading', { name: '在线图片导入', exact: true }),
      ).toHaveCount(2);
      await document.reload();
      await expect(
        document.getByRole('heading', { name: '在线图片导入', exact: true }),
      ).toHaveCount(2);
    } finally {
      await document.close();
    }
  }
  expect(errors).toEqual([]);
});

test('超过页码上限时保留真实总数和范围提示，不提供无效的第501页', async () => {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test')) throw Error('只接受隔离数据库');
  const database = createDatabase(source);
  try {
    await database.pool
      .query(`INSERT INTO outbox_events(topic,payload,attempts,last_error_code,created_at)
      SELECT 'system.probe','{"schemaVersion":1}',5,'DELIVERY_FAILED',now()-make_interval(secs=>i)
      FROM generate_series(1,10004) i`);
  } finally {
    await database.close();
  }
  await admin.goto('/admin/tasks?category=system&page=500');
  await expect(
    admin.getByRole('heading', { name: '需要处理 · 10,004', exact: true }),
  ).toBeVisible();
  await expect(admin.getByText('当前结果较多', { exact: true })).toBeVisible();
  await expect(admin.getByText('第 500 页，共 500 页', { exact: true })).toBeVisible();
  await expect(admin.getByRole('button', { name: '下一页', exact: true })).toBeDisabled();
});
