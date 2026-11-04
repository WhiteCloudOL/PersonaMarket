import { randomUUID } from 'node:crypto';
import { test as base, expect, type Browser, type Page } from '@playwright/test';
import { createDatabase } from '@personamarket/database';
import { createAdministrator } from '@personamarket/server';
import {
  AuthContextResponseSchema,
  SystemSettingsResponseSchema,
  canonicalJson,
  systemSettingsEtag,
  type SystemSettings,
} from '@personamarket/contracts';
import { browserWrite } from './browser-account.js';

export const systemEndpoint = '/api/v1/admin/settings/system';
export const systemSavedText = '维护设置已保存，新普通业务提交按当前维护状态处理';
export const testOrigin = () => process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100';
export function systemTestDatabaseUrl() {
  const value = process.env['TEST_DATABASE_URL'];
  if (!value || !/^\/pm_e2e_[a-f0-9]{32}_test$/.test(new URL(value).pathname))
    throw new Error('System E2E仅允许本轮受控隔离库');
  return value;
}
export async function currentSystem(page: Page) {
  const response = await page.request.get(systemEndpoint);
  expect(response.status()).toBe(200);
  return SystemSettingsResponseSchema.parse(await response.json());
}
export async function updateSystem(
  page: Page,
  data: SystemSettings,
  reason = '隔离浏览器核对维护设置',
) {
  const before = await currentSystem(page);
  const auth = AuthContextResponseSchema.parse(
    await (await page.request.get('/api/v1/auth/context')).json(),
  );
  if (!auth.data.account) throw new Error('缺少自有管理员会话');
  const response = await browserWrite(
    page,
    systemEndpoint,
    { data, reason, confirmed: true },
    'PATCH',
    {
      'If-Match': systemSettingsEtag(before.meta.revision),
      'Idempotency-Key': randomUUID(),
      'X-Expected-Account': auth.data.account.id,
    },
  );
  expect(response.status()).toBe(200);
  return SystemSettingsResponseSchema.parse(await response.json());
}
export const test = base.extend<{ systemAdministrator: { username: string; password: string } }>({
  systemAdministrator: [
    async ({ page }, use) => {
      const username = 'system_admin_' + randomUUID().replaceAll('-', '').slice(0, 10);
      const password = 'System policy browser passphrase 2026';
      const database = createDatabase(systemTestDatabaseUrl());
      try {
        await createAdministrator(database, {
          username,
          email: username + '@fixture.invalid',
          password,
        });
      } finally {
        await database.close();
      }
      const authenticate = async () => {
        expect(
          (
            await browserWrite(page, '/api/v1/auth/login', { identifier: username, password })
          ).status(),
        ).toBe(200);
      };
      await authenticate();
      const initial = await currentSystem(page);
      if (canonicalJson(initial.data) !== canonicalJson(initial.defaults))
        await updateSystem(page, initial.defaults, '初始化本用例维护关闭配置');
      try {
        await use({ username, password });
      } finally {
        await authenticate();
        const latest = await currentSystem(page);
        if (canonicalJson(latest.data) !== canonicalJson(latest.defaults))
          await updateSystem(page, latest.defaults, '结束本用例并明确恢复维护关闭');
      }
    },
    { auto: true },
  ],
});
test.use({ trace: 'off', screenshot: 'off' });
test.beforeEach(async ({ page }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
});
export async function openSystem(page: Page) {
  await page.goto('/admin/settings/system');
  await expect(page.getByText('当前表单与已读取配置一致', { exact: true })).toBeVisible();
}
export async function confirmSystemSave(page: Page) {
  await page.getByRole('button', { name: '保存维护设置', exact: true }).click();
}
export async function navigateSystemSettings(page: Page, name: string) {
  const selector = page.getByRole('button', { name: '选择设置分组', exact: true });
  if (await selector.isVisible()) await selector.click();
  const link = page.getByRole('link', { name, exact: true });
  const href = await link.getAttribute('href');
  if (!href) throw new Error('设置分组缺少真实目标');
  page.once('dialog', (dialog) => dialog.accept());
  await link.click();
  await expect(page).toHaveURL(new URL(href, testOrigin()).href);
  await expect(page.getByRole('dialog', { name: '网站设置', exact: true })).toBeHidden();
}
export async function systemBrowserContext(browser: Browser, page: Page) {
  return browser.newContext({
    baseURL: testOrigin(),
    viewport: page.viewportSize(),
    reducedMotion: 'reduce',
    hasTouch: test.info().project.name === 'mobile',
    isMobile: test.info().project.name === 'mobile',
  });
}
export async function loginSystemUser(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('用户名或邮箱', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
}
export async function expireSystemCredential(username: string, method: 'mfa' | 'password') {
  const database = createDatabase(systemTestDatabaseUrl());
  try {
    await database.pool.query(
      method === 'mfa'
        ? "UPDATE auth_sessions SET mfa_verified_at=now()-interval '11 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)"
        : "UPDATE auth_sessions SET created_at=now()-interval '11 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
      [username],
    );
  } finally {
    await database.close();
  }
}
