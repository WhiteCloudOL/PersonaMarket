import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { z } from 'zod';
import { createDatabase } from '@personamarket/database';
import { createAdministrator, createTotp } from '@personamarket/server';
import { MfaConfirmResponseSchema, ErrorResponseSchema } from '@personamarket/contracts';
/** 在隔离测试库创建管理员，再用真实浏览器完成 MFA；凭据不写入 trace。 */
export async function loginBrowserAdmin(page: Page) {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test'))
    throw new Error('管理员 E2E 需要隔离测试库');
  const username = 'reviewer_' + randomUUID().replaceAll('-', '').slice(0, 12);
  const password = 'Review browser administrator passphrase 2026';
  const db = createDatabase(source);
  try {
    await createAdministrator(db, { username, password, email: username + '@fixture.invalid' });
  } finally {
    await db.close();
  }
  await page.goto('/login');
  await page.getByLabel('用户名或邮箱').fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  const login = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/auth/login') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '登录', exact: true }).click();
  const loggedIn = await login;
  const failure =
    loggedIn.status() === 200
      ? undefined
      : ErrorResponseSchema.safeParse(await loggedIn.json().catch(() => null));
  expect({
    status: loggedIn.status(),
    error: failure?.success ? failure.data.error.code : undefined,
  }).toEqual({ status: 200, error: undefined });
  await expect(page).toHaveURL(/\/account$/);
  await page.getByRole('link', { name: '设置二次验证', exact: true }).click();
  const setup = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/auth/mfa/setup') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '开始绑定身份验证器' }).click();
  const secret = z
    .object({ data: z.object({ secret: z.string() }) })
    .parse(await (await setup).json()).data.secret;
  await page.getByLabel('六位动态验证码').fill(createTotp(secret, username).generate());
  const confirmation = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/auth/mfa/confirm') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '确认绑定', exact: true }).click();
  const confirmed = await confirmation;
  expect(confirmed.status()).toBe(200);
  const recoveryCode = MfaConfirmResponseSchema.parse(await confirmed.json()).data.recoveryCodes[0];
  if (!recoveryCode) throw new Error('缺少一次性测试恢复码');
  await page.getByRole('button', { name: '已安全保存，继续' }).click();
  await expect(page).toHaveURL(/\/account$/);
  return { username, recoveryCode };
}
