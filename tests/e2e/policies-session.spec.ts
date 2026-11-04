import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { createDatabase } from '@personamarket/database';
import { createAdministrator } from '@personamarket/server';
import {
  AdminUserResponseSchema,
  AuthContextResponseSchema,
  ErrorResponseSchema,
} from '@personamarket/contracts';
import { browserWrite } from '../fixtures/browser-account.js';

test.use({ trace: 'off', screenshot: 'off' });
const origin = process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100';
const policyPath = '/api/v1/admin/settings/policies/privacy';

async function login(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('用户名或邮箱', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  const response = page.waitForResponse(
    (item) => item.url().endsWith('/api/v1/auth/login') && item.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '登录', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page).toHaveURL(/\/account$/);
  const context = AuthContextResponseSchema.parse(
    await (await page.request.get('/api/v1/auth/context')).json(),
  ).data;
  expect(context.account?.username).toBe(username);
  expect(context.assurance).toBe('authenticated');
  expect(context.mfaEnabled).toBe(false);
  if (!context.account) throw Error('隔离测试账号未完成真实登录');
  return context.account;
}

test('管理员角色被真实撤销后保存前刷新身份并隐藏私有表单，普通身份重新登录仍被拒绝', async ({
  page,
  browser,
}, info) => {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test'))
    throw Error('规则会话验收只允许隔离测试数据库');
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  const database = createDatabase(source);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
  const first = 'psession_a_' + suffix,
    second = 'psession_b_' + suffix;
  const password = 'Policy session fixture passphrase 2026';
  const otherContext = await browser.newContext({ baseURL: origin });
  const messages: string[] = [];
  page.on('pageerror', (error) => messages.push(error.message));
  try {
    for (const username of [first, second])
      await createAdministrator(database, {
        username,
        password,
        email: username + '@fixture.invalid',
      });
    // B 先登录，后续只通过其独立 API context 操作，不切换 A 页面焦点。
    const manager = await otherContext.newPage();
    const managerAccount = await login(manager, second, password);
    expect(managerAccount.role).toBe('admin');
    const targetAccount = await login(page, first, password);
    expect(targetAccount.role).toBe('admin');
    await page.goto('/admin/settings/policies?document=privacy');
    await expect(page.getByLabel('规则标题', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '保存规则草稿', exact: true })).toBeVisible();

    const detailResponse = await manager.request.get('/api/v1/admin/users/' + targetAccount.id);
    expect(detailResponse.status()).toBe(200);
    const detail = AdminUserResponseSchema.parse(await detailResponse.json()).data;
    const changed = await browserWrite(
      manager,
      '/api/v1/admin/users/' + targetAccount.id + '/role',
      {
        role: 'user',
        expectedSecurityVersion: detail.securityVersion,
        reason: '隔离环境中核对规则页面的管理员角色撤销与身份刷新',
      },
      'PUT',
      { 'Idempotency-Key': randomUUID(), 'X-Expected-Account': managerAccount.id },
    );
    expect(changed.status()).toBe(200);
    const result = AdminUserResponseSchema.parse(await changed.json()).data;
    expect(result.role).toBe('user');
    expect(result.records[0]?.action).toBe('set_role');
    expect(result.records[0]?.actor.id).toBe(managerAccount.id);
    await expect(page.getByLabel('规则标题', { exact: true })).toBeVisible();

    const attemptedWrites: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === policyPath && request.method() === 'PATCH')
        attemptedWrites.push(request.method());
    });
    const refreshed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/auth/context' &&
        response.request().method() === 'GET',
    );
    await page.getByLabel('规则标题', { exact: true }).fill('权限撤销后的输入');
    await page.getByRole('button', { name: '保存规则草稿', exact: true }).click();
    const refreshedResponse = await refreshed;
    expect(refreshedResponse.status()).toBe(200);
    expect(
      AuthContextResponseSchema.parse(await refreshedResponse.json()).data.account?.role,
    ).not.toBe('admin');
    await expect(page.getByLabel('规则标题', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('规则正文', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '保存规则草稿', exact: true })).toHaveCount(0);
    await expect(page.getByText('此页面需要管理员权限', { exact: true })).toBeVisible();

    expect(attemptedWrites).toEqual([]);

    const regular = await login(page, first, password);
    expect(regular.id).toBe(targetAccount.id);
    expect(regular.role).toBe('user');
    await page.goto('/admin/settings/policies?document=privacy');
    await expect(page.getByText('此页面需要管理员权限', { exact: true })).toBeVisible();
    await expect(page.getByLabel('规则标题', { exact: true })).toHaveCount(0);
    const forbidden = await page.request.get(policyPath);
    expect(forbidden.status()).toBe(403);
    expect(ErrorResponseSchema.parse(await forbidden.json()).error.code).toBe('FORBIDDEN');
    const managerStillAdmin = AuthContextResponseSchema.parse(
      await (await manager.request.get('/api/v1/auth/context')).json(),
    ).data.account;
    expect(managerStillAdmin?.id).toBe(managerAccount.id);
    expect(managerStillAdmin?.role).toBe('admin');
    expect(messages).toEqual([]);
  } finally {
    await otherContext.close();
    await database.close();
  }
});
