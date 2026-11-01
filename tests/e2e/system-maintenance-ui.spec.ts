import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import {
  AuthContextResponseSchema,
  DraftResponseSchema,
  ErrorResponseSchema,
  MyPersonasResponseSchema,
  PersonaDraftSchema,
  SubmissionListResponseSchema,
  SystemRuntimeResponseSchema,
  emptyPersonaDraft,
} from '@personamarket/contracts';
import { browserWrite, loginCreator } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { logoutAccount } from '../fixtures/account-navigation.js';
import {
  test,
  systemEndpoint,
  currentSystem,
  updateSystem,
  openSystem,
  confirmSystemSave,
  systemBrowserContext,
} from '../fixtures/system-settings.js';

async function ownTotal(page: Page) {
  const response = await page.request.get('/api/v1/me/personas');
  expect(response.status()).toBe(200);
  return MyPersonasResponseSchema.parse(await response.json()).meta.total;
}
const errorBody = (message: string) => ({
  error: { code: 'SERVICE_UNAVAILABLE', message, fieldErrors: [], requestId: randomUUID() },
});

test('真实维护拒绝普通与管理员创作者新建并保留双平台输入，关闭后仅明确重试才创建', async ({
  page,
  browser,
}) => {
  const context = await systemBrowserContext(browser, page);
  const adminCreator = await page.context().newPage();
  try {
    const author = await context.newPage();
    await loginCreator(author);
    const before = await ownTotal(author),
      adminBefore = await ownTotal(adminCreator);
    await author.goto('/dashboard/personas/new');
    await author.getByLabel('人设名称', { exact: true }).fill('隔离维护保留的创作');
    await author.getByLabel('人格设定', { exact: true }).fill('MaiBot私有输入保留');
    await author.getByRole('button', { name: 'AstrBot', exact: true }).click();
    await author.getByLabel('人格设定', { exact: true }).fill('AstrBot私有输入保留');
    let posts = 0;
    author.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/me/personas')
        posts++;
    });
    const state = await currentSystem(page);
    await updateSystem(page, {
      ...state.data,
      maintenanceEnabled: true,
      maintenanceMessage: '隔离验收：当前暂停新提交，登录恢复可用',
    });
    const rejected = author.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/me/personas') && response.request().method() === 'POST',
    );
    await author.getByRole('button', { name: '创建私有草稿', exact: true }).click();
    expect((await rejected).status()).toBe(503);
    expect(ErrorResponseSchema.parse(await (await rejected).json()).error.code).toBe(
      'MAINTENANCE_MODE',
    );
    const notice = author.getByLabel('维护提交提示', { exact: true });
    await expect(notice).toBeVisible();
    await expect(author.getByLabel('人设名称', { exact: true })).toHaveValue('隔离维护保留的创作');
    await author.getByRole('button', { name: 'MaiBot', exact: true }).click();
    await expect(author.getByLabel('人格设定', { exact: true })).toHaveValue('MaiBot私有输入保留');
    await author.getByRole('button', { name: 'AstrBot', exact: true }).click();
    await expect(author.getByLabel('人格设定', { exact: true })).toHaveValue('AstrBot私有输入保留');
    expect(await ownTotal(author)).toBe(before);
    await adminCreator.goto('/dashboard/personas/new');
    await adminCreator.getByLabel('人设名称', { exact: true }).fill('管理员创作者同样维护受限');
    const adminRejected = adminCreator.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/me/personas') && response.request().method() === 'POST',
    );
    await adminCreator.getByRole('button', { name: '创建私有草稿', exact: true }).click();
    expect((await adminRejected).status()).toBe(503);
    expect(await ownTotal(adminCreator)).toBe(adminBefore);
    await updateSystem(page, { ...(await currentSystem(page)).data, maintenanceEnabled: false });
    await notice.getByRole('button', { name: '核对维护状态', exact: true }).click();
    await expect(
      notice.getByText('当前维护已关闭，请自行重试刚才的操作', { exact: true }),
    ).toBeVisible();
    expect(posts).toBe(1);
    expect(await ownTotal(author)).toBe(before);
    await author.getByRole('button', { name: '创建私有草稿', exact: true }).click();
    await expect(author).toHaveURL(/\/edit$/);
    expect(posts).toBe(2);
    expect(await ownTotal(author)).toBe(before + 1);
    await expect(author.getByLabel('人设名称', { exact: true })).toHaveValue('隔离维护保留的创作');
    await expect(author.getByLabel('人格设定', { exact: true })).toHaveValue('AstrBot私有输入保留');
  } finally {
    await adminCreator.close();
    await context.close();
  }
});

test('维护期间Release表单保留版本日志与原幂等key，恢复后同请求明确重试且仅一个PENDING', async ({
  page,
  browser,
}) => {
  const context = await systemBrowserContext(browser, page);
  try {
    const author = await context.newPage();
    await loginCreator(author);
    const draft = PersonaDraftSchema.parse({
      ...emptyPersonaDraft('maibot', '隔离维护发版验收'),
      summary: '维护前真实业务准备的私有作品',
      content: { personality: '耐心的向导', replyStyle: '亲切简洁', behaviorStyle: '尊重对话边界' },
      readmeMarkdown: '# 隔离验收\n\n用于正常维护恢复流程',
      rightsAccepted: true,
    });
    const created = await browserWrite(author, '/api/v1/me/personas', {
      platform: draft.platform,
      title: draft.title,
      initialDraft: draft,
    });
    expect(created.status()).toBe(200);
    const saved = DraftResponseSchema.parse(await created.json());
    const releasePath = '/api/v1/me/personas/' + saved.data.id + '/releases';
    await author.goto('/dashboard/personas/' + saved.data.id + '/edit');
    await author.getByRole('button', { name: '创建 Release', exact: true }).click();
    const sheet = author.getByRole('dialog', { name: '确认本次发版', exact: true });
    await sheet.getByLabel('版本号', { exact: true }).fill('1.0.0');
    await sheet.getByLabel('更新日志', { exact: true }).fill('维护前已填写的更新说明');
    await sheet
      .getByRole('checkbox', {
        name: '我已核对公开内容、版本号及来源许可，确认提交审核',
        exact: true,
      })
      .check();
    const keys: Array<string | undefined> = [];
    author.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === releasePath)
        keys.push(request.headers()['idempotency-key']);
    });
    await updateSystem(page, {
      ...(await currentSystem(page)).data,
      maintenanceEnabled: true,
      maintenanceMessage: '隔离发版维护提示',
    });
    const rejected = author.waitForResponse(
      (response) => response.url().endsWith(releasePath) && response.request().method() === 'POST',
    );
    await sheet.getByRole('button', { name: '确认提交审核', exact: true }).click();
    expect((await rejected).status()).toBe(503);
    await expect(sheet.getByLabel('维护提交提示', { exact: true })).toBeVisible();
    await expect(sheet.getByLabel('版本号', { exact: true })).toHaveValue('1.0.0');
    await expect(sheet.getByLabel('更新日志', { exact: true })).toHaveValue(
      '维护前已填写的更新说明',
    );
    expect(
      SubmissionListResponseSchema.parse(await (await author.request.get(releasePath)).json()).data,
    ).toHaveLength(0);
    await updateSystem(page, { ...(await currentSystem(page)).data, maintenanceEnabled: false });
    await sheet
      .getByLabel('维护提交提示', { exact: true })
      .getByRole('button', { name: '核对维护状态', exact: true })
      .click();
    await expect(
      sheet.getByText('当前维护已关闭，请自行重试刚才的操作', { exact: true }),
    ).toBeVisible();
    expect(keys).toHaveLength(1);
    await sheet.getByRole('button', { name: '确认提交审核', exact: true }).click();
    await expect(sheet).toBeHidden();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    const submissions = SubmissionListResponseSchema.parse(
      await (await author.request.get(releasePath)).json(),
    );
    expect(submissions.data).toHaveLength(1);
    expect(submissions.data[0]?.status).toBe('PENDING');
  } finally {
    await context.close();
  }
});

test('维护开启仍可完整管理员MFA登录并关闭，普通登录与账号安全恢复不被截断', async ({
  page,
  browser,
}) => {
  const boundContext = await systemBrowserContext(browser, page),
    ordinaryContext = await systemBrowserContext(browser, page);
  try {
    const bound = await boundContext.newPage(),
      ordinary = await ordinaryContext.newPage();
    const errors: Array<{ path: string; kind: string }> = [];
    for (const target of [bound, ordinary])
      target.on('pageerror', (error) =>
        errors.push({
          path: new URL(target.url()).pathname,
          kind: /hydration|hydrated|#418/iu.test(error.message) ? 'HYDRATION' : 'SCRIPT_ERROR',
        }),
      );
    const administrator = await loginBrowserAdmin(bound);
    const creator = await loginCreator(ordinary);
    await logoutAccount(bound);
    await logoutAccount(ordinary);
    await updateSystem(page, {
      ...(await currentSystem(page)).data,
      maintenanceEnabled: true,
      maintenanceMessage: '隔离验收：维护期间仍保留管理恢复',
    });
    await bound.goto('/login');
    await bound.getByLabel('用户名或邮箱', { exact: true }).fill(administrator.username);
    await bound
      .getByLabel('密码', { exact: true })
      .fill('Review browser administrator passphrase 2026');
    await bound.getByRole('button', { name: '登录', exact: true }).click();
    await expect(bound).toHaveURL(/\/mfa(?:\?|$)/);
    await bound.getByLabel('动态验证码或恢复码', { exact: true }).fill(administrator.recoveryCode);
    await bound.getByRole('button', { name: '完成二次验证', exact: true }).click();
    await expect(bound).toHaveURL(/\/account$/);
    await ordinary.goto('/login');
    await ordinary.getByLabel('用户名或邮箱', { exact: true }).fill(creator.username);
    await ordinary.getByLabel('密码', { exact: true }).fill(creator.password);
    await ordinary.getByRole('button', { name: '登录', exact: true }).click();
    await expect(ordinary).toHaveURL(/\/account$/);
    const context = AuthContextResponseSchema.parse(
      await (await ordinary.request.get('/api/v1/auth/context')).json(),
    );
    expect(context.data.account?.username).toBe(creator.username);
    expect(context.data.assurance).toBe('authenticated');
    expect(
      (
        await browserWrite(ordinary, '/api/v1/auth/forgot-password', { email: creator.email })
      ).status(),
    ).toBe(200);
    await openSystem(bound);
    await bound.getByRole('switch', { name: '开启维护模式', exact: true }).uncheck();
    await bound.getByLabel('处理理由', { exact: true }).fill('维护中完整MFA登录后的受控恢复');
    await confirmSystemSave(bound);
    expect((await currentSystem(bound)).data.maintenanceEnabled).toBe(false);
    expect(
      AuthContextResponseSchema.parse(
        await (await ordinary.request.get('/api/v1/auth/context')).json(),
      ).data.assurance,
    ).toBe('authenticated');
    expect(errors).toEqual([]);
  } finally {
    await boundContext.close();
    await ordinaryContext.close();
  }
});

test('API产物与实际就绪范围真实读取，unknown或读取失败不沿用健康，公开冷热水合保留登录入口', async ({
  page,
  browser,
}) => {
  await openSystem(page);
  await page.getByRole('button', { name: '查看运行信息', exact: true }).click();
  const panel = page.getByRole('region', { name: 'API运行信息', exact: true });
  const runtime = SystemRuntimeResponseSchema.parse(
    await (await page.request.get(systemEndpoint + '/runtime')).json(),
  );
  await expect(panel.getByText(runtime.data.nodeVersion, { exact: true })).toBeVisible();
  await expect(panel).toContainText('不能据此确认Web或Worker版本');
  const runtimePattern = '**/api/v1/admin/settings/system/runtime';
  await page.route(runtimePattern, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          component: 'api',
          nodeVersion: runtime.data.nodeVersion,
          build: {
            version: null,
            sourceRevision: null,
            sourceDirty: null,
            builtAt: null,
            status: 'unavailable',
          },
        },
      }),
    }),
  );
  await panel.getByRole('button', { name: '重新读取API信息', exact: true }).click();
  await expect(panel.getByText('未知，尚无有效构建元数据', { exact: true })).toBeVisible();
  await expect(panel.getByText('来自API构建产物', { exact: true })).toHaveCount(0);
  await page.unroute(runtimePattern);
  await page.route(runtimePattern, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify(errorBody('隔离浏览器暂时无法读取运行信息')),
    }),
  );
  await panel.getByRole('button', { name: '重新读取API信息', exact: true }).click();
  await expect(panel.getByText('隔离浏览器暂时无法读取运行信息', { exact: true })).toBeVisible();
  await expect(panel.getByText(runtime.data.nodeVersion, { exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: '检查必要服务就绪', exact: true }).click();
  await expect(panel.getByText('本次必要服务就绪检查通过', { exact: true })).toBeVisible();
  await page.route('**/health/ready', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify(errorBody('隔离浏览器本次就绪读取失败')),
    }),
  );
  await panel.getByRole('button', { name: '检查必要服务就绪', exact: true }).click();
  await expect(panel.getByText('隔离浏览器本次就绪读取失败', { exact: true })).toBeVisible();
  await expect(panel.getByText('本次必要服务就绪检查通过', { exact: true })).toHaveCount(0);
  await expect(panel.getByRole('link', { name: '查看运行观测', exact: true })).toHaveAttribute(
    'href',
    '/admin',
  );
  await expect(panel.getByRole('link', { name: '查看失败任务', exact: true })).toHaveAttribute(
    'href',
    '/admin/tasks',
  );
  const hint = '隔离验收维护提示\nhttps://example.com/正常说明 **保留为纯文本**';
  await updateSystem(page, {
    ...(await currentSystem(page)).data,
    maintenanceMessage: hint,
    maintenanceEnabled: true,
  });
  const guestContext = await systemBrowserContext(browser, page),
    authorContext = await systemBrowserContext(browser, page);
  const errors: Array<{ path: string; kind: string }> = [];
  const observe = (target: Page) =>
    target.on('pageerror', (error) =>
      errors.push({
        path: new URL(target.url()).pathname,
        kind: /hydration|hydrated|#418/iu.test(error.message) ? 'HYDRATION' : 'SCRIPT_ERROR',
      }),
    );
  try {
    const guest = await guestContext.newPage();
    observe(guest);
    for (const route of ['/', '/register', '/login']) {
      await guest.goto(route);
      await expect(guest.getByLabel('站点维护提示', { exact: true })).toContainText(hint);
      await guest.reload();
      await expect(guest.getByLabel('站点维护提示', { exact: true })).toContainText(hint);
    }
    await expect(guest.getByLabel('用户名或邮箱', { exact: true })).toBeEnabled();
    await guest.route('**/api/v1/public/system-status', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify(errorBody('隔离浏览器维护状态暂时不可读')),
      }),
    );
    await guest
      .getByLabel('站点维护提示', { exact: true })
      .getByRole('button', { name: '核对维护状态', exact: true })
      .click();
    await expect(guest.getByLabel('维护状态读取提示', { exact: true })).toBeVisible();
    await expect(guest.getByLabel('站点维护提示', { exact: true })).toHaveCount(0);
    await expect(guest.getByLabel('用户名或邮箱', { exact: true })).toBeEnabled();
    await updateSystem(page, { ...(await currentSystem(page)).data, maintenanceEnabled: false });
    const author = await authorContext.newPage();
    observe(author);
    await loginCreator(author);
    await updateSystem(page, { ...(await currentSystem(page)).data, maintenanceEnabled: true });
    await author.goto('/dashboard/personas/new');
    await expect(author.getByLabel('人设名称', { exact: true })).toBeVisible();
    await expect(author.getByLabel('站点维护提示', { exact: true })).toContainText(hint);
    await author.reload();
    await expect(author.getByLabel('人设名称', { exact: true })).toBeEnabled();
    expect(errors).toEqual([]);
    await updateSystem(page, { ...(await currentSystem(page)).data, maintenanceEnabled: false });
    await author
      .getByLabel('站点维护提示', { exact: true })
      .getByRole('button', { name: '核对维护状态', exact: true })
      .click();
    await expect(author.getByLabel('站点维护提示', { exact: true })).toHaveCount(0);
    await expect(author.locator('main')).not.toContainText(hint);
  } finally {
    await guestContext.close();
    await authorContext.close();
    if (!page.isClosed()) {
      await page.unroute(runtimePattern);
      await page.unroute('**/health/ready');
    }
  }
});
