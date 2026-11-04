import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { AuthContextResponseSchema } from '@personamarket/contracts';
import { mailCode } from './mailpit.js';
export async function browserWrite(
  page: Page,
  path: string,
  body?: unknown,
  method = 'POST',
  headers: Record<string, string> = {},
) {
  const context = AuthContextResponseSchema.parse(
    // 认证上下文可重新获取，仅允许一次ECONNRESET重试，后续业务写请求仍不自动重试
    await (await page.request.get('/api/v1/auth/context', { maxRetries: 1 })).json(),
  );
  return page.request.fetch(path, {
    method,
    headers: {
      Origin: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
      'X-CSRF-Token': context.data.csrfToken,
      ...headers,
    },
    ...(body === undefined ? {} : { data: body }),
  });
}
export async function loginCreator(page: Page) {
  const username = 'creator_' + randomUUID().replaceAll('-', '').slice(0, 12);
  const email = username + '@fixture.invalid';
  const password = 'A real creative account passphrase 2026';
  expect((await browserWrite(page, '/api/v1/auth/register/code', { email })).status()).toBe(200);
  const code = await mailCode(email, '注册');
  expect(
    (
      await browserWrite(page, '/api/v1/auth/register', { username, email, password, code })
    ).status(),
  ).toBe(200);
  await page.goto('/login');
  await page.getByLabel('用户名或邮箱').fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  return { username, email, password };
}
