import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '@personamarket/database';
import { createAdministrator } from '@personamarket/server';

test.use({ trace: 'off', screenshot: 'off' });

test('脚本未启用时凭据输入和提交保持禁用，表单回退不使用GET', async ({
  browser,
  viewport,
}, info) => {
  const context = await browser.newContext({
    viewport,
    isMobile: info.project.name === 'mobile',
    hasTouch: info.project.name !== 'desktop',
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    javaScriptEnabled: false,
  });
  try {
    const page = await context.newPage();
    for (const [route, label] of [
      ['/login', '密码'],
      ['/forgot-password', '注册邮箱'],
      ['/reset-password', '新密码'],
    ] as const) {
      await page.goto(route);
      const input = page.getByLabel(label, { exact: true });
      await expect(input).toBeDisabled();
      const form = page.locator('form').filter({ has: input });
      await expect(form).toHaveAttribute('method', 'post');
      // Next 的流式边界在禁用脚本时可能保持隐藏，仍核对原生控件的安全属性。
      await expect(
        form.getByRole('button', { name: /登录|发送重置邮件|重置密码/, includeHidden: true }),
      ).toBeDisabled();
      await expect(page.getByText('请启用浏览器脚本后继续操作', { exact: true })).toBeAttached();
    }
  } finally {
    await context.close();
  }
});

test('延迟客户端脚本时SSR表单不可提交，接管后通过真实API登录且凭据不进入URL', async ({
  browser,
  viewport,
}, info) => {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test')) throw new Error('需要隔离数据库');
  const username = 'hydration_' + randomUUID().replaceAll('-', '').slice(0, 12);
  const password = 'Hydration boundary fixture passphrase 2026';
  const database = createDatabase(source);
  try {
    await createAdministrator(database, {
      username,
      password,
      email: username + '@fixture.invalid',
    });
  } finally {
    await database.close();
  }
  const context = await browser.newContext({
    viewport,
    isMobile: info.project.name === 'mobile',
    hasTouch: info.project.name !== 'desktop',
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
  });
  let release = () => {};
  const scripts = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const page = await context.newPage();
    let credentialUrls = 0;
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (['password', 'code', 'token'].some((key) => url.searchParams.has(key))) credentialUrls++;
    });
    await page.route(
      (url) => url.pathname.startsWith('/_next/static/') && url.pathname.endsWith('.js'),
      async (route) => {
        await scripts;
        await route.continue();
      },
    );
    await page.goto('/login', { waitUntil: 'commit' });
    const identifier = page.getByLabel('用户名或邮箱', { exact: true });
    const secret = page.getByLabel('密码', { exact: true });
    await expect(identifier).toBeDisabled();
    await expect(secret).toBeDisabled();
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeDisabled();
    release();
    await page.unrouteAll({ behavior: 'wait' });
    await expect(identifier).toBeEnabled();
    await expect(secret).toBeEnabled();
    await identifier.fill(username);
    await secret.fill(password);
    const login = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/auth/login') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '登录', exact: true }).click();
    expect((await login).status()).toBe(200);
    await expect(page).toHaveURL(/\/account$/);
    expect(credentialUrls).toBe(0);
  } finally {
    release();
    await context.unrouteAll({ behavior: 'wait' });
    await context.close();
  }
});
