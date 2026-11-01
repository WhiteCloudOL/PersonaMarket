import { selectTheme } from '../fixtures/theme.js';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { loginCreator, browserWrite } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';

test.use({ trace: 'off', screenshot: 'off' });

test('创作提示在本页登录并返回，保留两个平台正文且不手动读取登录状态', async ({ page }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  const account = await loginCreator(page);
  expect((await browserWrite(page, '/api/v1/auth/logout')).status()).toBe(200);
  await page.goto('/dashboard/personas/new');
  await page.getByLabel('人设名称', { exact: true }).fill('本页登录后继续创作');
  await page.getByLabel('人格设定', { exact: true }).fill('保留 MaiBot 正文');
  await page.getByRole('button', { name: 'AstrBot', exact: true }).click();
  await page.getByLabel('人格设定', { exact: true }).fill('保留 AstrBot 正文');
  const evidence = join('data/tests/persona-create-login', info.project.name, randomUUID());
  await mkdir(evidence, { recursive: true });
  await page.getByRole('heading', { name: '创建人设', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(evidence, 'prompt.png') });
  const login = page.getByRole('link', { name: '去登录', exact: true });
  await expect(login).toBeVisible();
  await expect(page.getByRole('button', { name: '读取登录状态', exact: true })).toHaveCount(0);
  await expect(login).not.toHaveAttribute('target', '_blank');
  expect(
    await login.evaluate((element) => element.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
  expect(
    await login.evaluate((element) => element.getBoundingClientRect().width),
  ).toBeGreaterThanOrEqual(44);
  await selectTheme(page, 'dark');
  await page.screenshot({ path: join(evidence, 'prompt-dark.png') });
  await selectTheme(page, 'light');
  const pages = page.context().pages().length;
  let dialogs = 0;
  page.on('dialog', async (dialog) => {
    dialogs++;
    await dialog.dismiss();
  });
  await login.focus();
  await login.press('Enter');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fdashboard%2Fpersonas%2Fnew$/);
  expect(page.context().pages()).toHaveLength(pages);
  expect(dialogs).toBe(0);
  await page.getByLabel('用户名或邮箱').fill(account.username);
  await page.getByLabel('密码', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/personas\/new$/);
  await expect(page.getByLabel('人设名称', { exact: true })).toHaveValue('本页登录后继续创作');
  await expect(page.getByLabel('人格设定', { exact: true })).toHaveValue('保留 AstrBot 正文');
  await page.getByRole('button', { name: 'MaiBot', exact: true }).click();
  await expect(page.getByLabel('人格设定', { exact: true })).toHaveValue('保留 MaiBot 正文');
  await expect(login).toHaveCount(0);
  await expect(page.getByLabel('上传作品图片', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('创作登录回跳须先完成真实 MFA，不能通过返回地址跳过验证', async ({ page }) => {
  const account = await loginBrowserAdmin(page);
  expect((await browserWrite(page, '/api/v1/auth/logout')).status()).toBe(200);
  await page.goto('/dashboard/personas/new');
  await page.getByLabel('人设名称', { exact: true }).fill('通过验证再继续');
  await page.getByRole('link', { name: '去登录', exact: true }).click();
  await page.getByLabel('用户名或邮箱').fill(account.username);
  await page
    .getByLabel('密码', { exact: true })
    .fill('Review browser administrator passphrase 2026');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/mfa\?returnTo=%2Fdashboard%2Fpersonas%2Fnew$/);
  expect((await page.request.get('/api/v1/me/personas')).status()).toBe(403);
  await page.getByLabel('动态验证码或恢复码').fill(account.recoveryCode);
  await page.getByRole('button', { name: '完成二次验证', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/personas\/new$/);
  await expect(page.getByLabel('人设名称', { exact: true })).toHaveValue('通过验证再继续');
});

test('外站返回地址被拒绝，登录仍回到本站账号页', async ({ page }) => {
  const account = await loginCreator(page);
  expect((await browserWrite(page, '/api/v1/auth/logout')).status()).toBe(200);
  await page.goto(
    '/login?returnTo=' + encodeURIComponent('//attacker.invalid/dashboard/personas/new'),
  );
  await page.getByLabel('用户名或邮箱').fill(account.username);
  await page.getByLabel('密码', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
});
