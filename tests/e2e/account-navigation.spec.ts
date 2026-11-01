import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { AdminUserResponseSchema, AuthContextResponseSchema } from '@personamarket/contracts';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { browserWrite, loginCreator } from '../fixtures/browser-account.js';
import {
  accountNavigationItem,
  closeAccountNavigation,
  selectAccountNavigation,
  logoutAccount,
} from '../fixtures/account-navigation.js';

test.use({ trace: 'off', screenshot: 'off' });

test('管理员导航按任务渐进展开，全部原入口仍可访问且关闭后焦点恢复', async ({ page }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  const administrator = await loginBrowserAdmin(page);
  await page.goto('/explore');
  await page.getByRole('button', { name: '打开账号菜单', exact: true }).click();
  const mobile = (page.viewportSize()?.width ?? 0) < 1024;
  if (mobile) {
    const sheet = page.getByRole('dialog', { name: '账号导航', exact: true });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('tab')).toHaveText(['个人', '审核', '运营', '系统']);
    await expect(sheet.getByRole('link')).toHaveCount(7);
    await expect(sheet.getByRole('link', { name: '用户管理', exact: true })).toHaveCount(0);
    for (const link of await sheet.getByRole('link').all()) {
      expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
  } else {
    const root = page.getByRole('menu');
    await expect(root.getByRole('menuitem')).toHaveCount(11);
    await expect(root.getByRole('menuitem', { name: '指南内容', exact: true })).toHaveCount(0);
    const group = root.getByRole('menuitem', { name: '运营', exact: true });
    await group.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('menuitem', { name: '指南内容', exact: true })).toBeVisible();
  }
  await closeAccountNavigation(page);
  for (const [label, href] of Object.entries({
    公开主页: '/users/' + administrator.username,
    个人资料: '/dashboard/profile',
    我的收藏: '/dashboard/favorites',
    我的举报: '/dashboard/reports',
    我的通知: '/dashboard/notifications',
    创作工作台: '/dashboard/personas',
    账号与安全: '/account',
    管理概览: '/admin',
    内容审核: '/admin/moderation',
    评论审核: '/admin/comments',
    资料审核: '/admin/profiles',
    举报处理: '/admin/reports',
    人设管理: '/admin/personas',
    分类管理: '/admin/categories',
    标签管理: '/admin/tags',
    公告管理: '/admin/announcements',
    指南内容: '/admin/guides',
    通知管理: '/admin/notifications',
    用户管理: '/admin/users',
    失败任务: '/admin/tasks',
    站点设置: '/admin/settings/brand',
  })) {
    const item = await accountNavigationItem(page, label);
    await expect(item).toBeVisible();
    await expect(item).toHaveAttribute('href', href);
    await closeAccountNavigation(page);
  }
  await selectAccountNavigation(page, '指南内容');
  await expect(page).toHaveURL(/\/admin\/guides$/);
  await expect(
    page.getByRole('heading', { level: 1, name: '指南内容', exact: true }),
  ).toBeVisible();
});

test('展开导航和切换视口保留正在编辑的表单，普通用户无管理入口，退出清理会话', async ({ page }) => {
  await loginCreator(page);
  await page.goto('/dashboard/personas/new');
  const title = page.getByLabel('人设名称', { exact: true });
  await title.fill('保留导航前正在编辑的角色');
  await page.getByRole('button', { name: '打开账号菜单', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '系统', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '系统', exact: true })).toHaveCount(0);
  await closeAccountNavigation(page);
  await expect(title).toHaveValue('保留导航前正在编辑的角色');
  await page.getByRole('button', { name: '打开账号菜单', exact: true }).click();
  const size = page.viewportSize();
  await page.setViewportSize({ width: (size?.width ?? 1440) < 1024 ? 1440 : 390, height: 844 });
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '账号导航', exact: true })).toHaveCount(0);
  await expect(title).toHaveValue('保留导航前正在编辑的角色');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  // 当前表单尚未保存，不离页；恢复空值后通过真实导航退出。
  await title.fill('');
  await logoutAccount(page);
  await expect(page.getByRole('button', { name: '打开账号菜单', exact: true })).toHaveCount(0);
  expect((await page.request.get('/api/v1/me/personas')).status()).toBe(401);
});

test('管理员密码登录尚未完成MFA时，导航仅允许继续验证及退出', async ({ page }) => {
  const admin = await loginBrowserAdmin(page);
  await logoutAccount(page);
  await page.goto('/login');
  await page.getByLabel('用户名或邮箱').fill(admin.username);
  await page
    .getByLabel('密码', { exact: true })
    .fill('Review browser administrator passphrase 2026');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/mfa$/);
  const account = await accountNavigationItem(page, '账号与安全');
  await expect(account).toHaveAttribute('href', '/mfa');
  await expect(page.getByRole('menuitem', { name: '审核', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '审核', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '创作工作台', exact: true })).toHaveCount(0);
  await closeAccountNavigation(page);
  expect((await page.request.get('/api/v1/admin/users')).status()).toBe(403);
});

test('退出遇到真实传输失败时保留会话、显示错误且可重试', async ({ page }) => {
  await loginCreator(page);
  await page.goto('/explore');
  await page.route('**/api/v1/auth/logout', (route) => route.abort('failed'));
  await selectAccountNavigation(page, '退出');
  await expect(page.getByRole('alert').filter({ hasText: '退出失败，请重试' })).toBeVisible();
  await expect(page.locator('[data-site-header] [aria-label="打开账号菜单"]')).toHaveCount(1);
  expect((await page.request.get('/api/v1/me/personas')).status()).toBe(200);
  await page.unroute('**/api/v1/auth/logout');
  const response = page.waitForResponse(
    (result) =>
      result.url().endsWith('/api/v1/auth/logout') && result.request().method() === 'POST',
  );
  const sheet = page.getByRole('dialog', { name: '账号导航', exact: true });
  if (await sheet.isVisible())
    await sheet.getByRole('button', { name: '退出', exact: true }).click();
  else await selectAccountNavigation(page, '退出');
  expect((await response).status()).toBe(200);
  await expect(
    page
      .getByRole('navigation', { name: '账号导航', exact: true })
      .getByRole('link', { name: '登录', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '打开账号菜单', exact: true })).toHaveCount(0);
  expect((await page.request.get('/api/v1/me/personas')).status()).toBe(401);
});

test('真实授予审核员后只有个人和审核分组，不出现运营或系统权限入口', async ({ page, browser }) => {
  const user = await loginCreator(page);
  const identity = AuthContextResponseSchema.parse(
    await (await page.request.get('/api/v1/auth/context')).json(),
  ).data.account;
  if (!identity) throw new Error('缺少隔离测试用户');
  const context = await browser.newContext({
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
  });
  try {
    const admin = await context.newPage();
    await loginBrowserAdmin(admin);
    const detail = AdminUserResponseSchema.parse(
      await (await admin.request.get('/api/v1/admin/users/' + identity.id)).json(),
    ).data;
    const changed = await browserWrite(
      admin,
      '/api/v1/admin/users/' + identity.id + '/role',
      {
        role: 'moderator',
        expectedSecurityVersion: detail.securityVersion,
        reason: '验证审核员导航边界',
      },
      'PUT',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(changed.status()).toBe(200);
    await page.goto('/login');
    await page.getByLabel('用户名或邮箱').fill(user.username);
    await page.getByLabel('密码', { exact: true }).fill(user.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL(/\/account$/);
    const review = await accountNavigationItem(page, '评论审核');
    await expect(review).toBeVisible();
    await expect(review).toHaveAttribute('href', '/admin/comments');
    await expect(page.getByRole('menuitem', { name: '运营', exact: true })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: '系统', exact: true })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: '运营', exact: true })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: '系统', exact: true })).toHaveCount(0);
    await closeAccountNavigation(page);
    expect((await page.request.get('/api/v1/admin/users')).status()).toBe(403);
  } finally {
    await context.close();
  }
});
