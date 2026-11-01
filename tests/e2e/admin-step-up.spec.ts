import { expect, test } from '@playwright/test';
import { createDatabase } from '@personamarket/database';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { MailSettingsResponseSchema } from '@personamarket/contracts';
test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });
test('日常审核无额外 MFA，高危保存就地验证并保留表单且不自动执行', async ({ page }) => {
  const admin = await loginBrowserAdmin(page);
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test')) throw new Error('必须使用隔离测试库');
  const database = createDatabase(source);
  try {
    await database.pool.query(
      "UPDATE auth_sessions SET mfa_verified_at=now()-interval '11 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
      [admin.username],
    );
  } finally {
    await database.close();
  }
  await page.goto('/admin/moderation');
  await expect(page.getByText('这个分组暂时没有提交', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '验证高危操作', exact: true })).toHaveCount(0);
  await page.goto('/admin/settings/mail');
  await page.getByRole('button', { name: '自定义 SMTP', exact: true }).click();
  await page.getByLabel('发件邮箱', { exact: true }).fill('verified-step-up@fixture.invalid');
  await page.getByRole('button', { name: '保存邮件设置', exact: true }).click();
  await page.getByRole('button', { name: '验证高危操作', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '验证高危操作', exact: true });
  await modal.getByLabel('动态验证码或恢复码', { exact: true }).fill(admin.recoveryCode);
  await modal.getByRole('button', { name: '确认身份', exact: true }).click();
  await expect(modal).toBeHidden();
  await expect(page).toHaveURL(/\/admin\/settings\/mail$/);
  await expect(page.getByLabel('发件邮箱', { exact: true })).toHaveValue(
    'verified-step-up@fixture.invalid',
  );
  const unchanged = await page.request.get('/api/v1/admin/settings/mail');
  expect(MailSettingsResponseSchema.parse(await unchanged.json()).data.mode).toBe('environment');
  let releaseSave: () => void = () => {
    throw new Error('请求尚未进入真实保存路径');
  };
  const gate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  let observeSave: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    observeSave = resolve;
  });
  await page.route('**/api/v1/admin/settings/mail', async (route) => {
    if (route.request().method() === 'PATCH') {
      observeSave();
      await gate;
    }
    await route.continue();
  });
  await page.getByRole('button', { name: '保存邮件设置', exact: true }).click();
  try {
    await started;
    await expect(page.getByLabel('发件邮箱', { exact: true })).toBeDisabled();
  } finally {
    releaseSave();
  }
  await expect(
    page.getByText('上次修改已保存，API 和 Worker 将使用当前邮件配置', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '验证高危操作', exact: true })).toHaveCount(0);
});
