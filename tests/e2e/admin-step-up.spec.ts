import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { createDatabase } from '@personamarket/database';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { MailSettingsResponseSchema } from '@personamarket/contracts';
test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });
test('日常审核无额外 MFA，高危保存就地验证并保留表单且不自动执行', async ({ page }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
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
  const phase = process.env['STEP_UP_CAPTURE'];
  const directory = 'data/tests/step-up';
  if (phase === 'after') {
    await mkdir(directory, { recursive: true });
    await page.getByLabel('SMTP 密码', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: directory + '/smtp-after-' + info.project.name + '.png' });
  }
  await page.getByRole('button', { name: '保存邮件设置', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '验证高危操作', exact: true });
  await expect(modal).toBeVisible();
  await expect(page.getByRole('button', { name: '验证高危操作', exact: true })).toHaveCount(0);
  expect((await modal.boundingBox())?.height).toBeLessThan(420);
  const credential = modal.getByLabel('动态验证码或恢复码', { exact: true });
  if (info.project.name === 'desktop') await expect(credential).toBeFocused();
  if (phase === 'after') {
    await page.screenshot({ path: directory + '/verification-' + info.project.name + '.png' });
  }
  await credential.fill('temporary-incorrect-code');
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await expect(page.getByText('已取消身份验证，再次提交可重新验证')).toBeVisible();
  await page.getByRole('button', { name: '保存邮件设置', exact: true }).click();
  await expect(modal).toBeVisible();
  await expect(credential).toHaveValue('');
  await credential.fill(admin.recoveryCode);
  await modal.getByRole('button', { name: '确认身份', exact: true }).click();
  await expect(modal).toBeHidden();
  await expect(
    page.getByRole('status').filter({ hasText: '身份已确认' }).locator('..'),
  ).toBeFocused();
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
  await expect(modal).toHaveCount(0);
  await page.goto('/admin/settings/accounts');
  await page.getByRole('switch', { name: '开放新用户注册', exact: true }).click();
  await page.getByRole('button', { name: '保存注册设置', exact: true }).click();
  await expect(page.getByText('注册设置已保存', { exact: false })).toBeVisible();
  await expect(modal).toHaveCount(0);
});

test('SMTP 密码留空保留、输入替换、明确清除，切换来源保留当前输入', async ({ page }, info) => {
  await loginBrowserAdmin(page);
  await page.goto('/admin/settings/mail');
  const source = page.getByRole('button', { name: '自定义 SMTP', exact: true });
  await expect(source).toBeVisible();
  if ((await source.getAttribute('aria-pressed')) !== 'true') await source.click();
  const password = page.getByLabel('SMTP 密码', { exact: true });
  const username = page.getByLabel('SMTP 用户名', { exact: true });
  const sender = page.getByLabel('发件邮箱', { exact: true });
  const save = page.getByRole('button', { name: '保存邮件设置', exact: true });
  const clear = page.getByRole('button', { name: '清除密码', exact: true });
  const undo = page.getByRole('button', { name: '撤销清除', exact: true });
  const endpoint = '/api/v1/admin/settings/mail';
  await expect(password).toHaveValue('');
  await expect(page.getByRole('button', { name: '保留已存密码', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '替换密码', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '恢复部署默认值', exact: true })).toHaveCount(0);
  await username.fill('smtp-fixture');
  await password.fill('fixture-secret-first');
  await page.getByRole('button', { name: '继承部署配置', exact: true }).click();
  await source.click();
  await expect(username).toHaveValue('smtp-fixture');
  await expect(password).not.toHaveValue('');
  async function saveAction(action: 'keep' | 'replace' | 'clear', configured: boolean) {
    const reply = page.waitForResponse(
      (response) => response.url().endsWith(endpoint) && response.request().method() === 'PATCH',
    );
    await save.click();
    const response = await reply;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON().password.action).toBe(action);
    expect(MailSettingsResponseSchema.parse(await response.json()).data.passwordConfigured).toBe(
      configured,
    );
    await expect(
      page.getByText('上次修改已保存，API 和 Worker 将使用当前邮件配置', { exact: true }),
    ).toBeVisible();
    await expect(save).toBeDisabled();
    await expect(password).toHaveValue('');
  }
  await saveAction('replace', true);
  await sender.fill('smtp-password-keep@fixture.invalid');
  await saveAction('keep', true);
  await password.fill('fixture-secret-replacement');
  await saveAction('replace', true);
  await expect(clear).toBeEnabled();
  await clear.click();
  if (process.env['STEP_UP_CAPTURE'] === 'after') {
    await page.screenshot({ path: 'data/tests/step-up/clear-' + info.project.name + '.png' });
  }
  await expect(undo).toBeVisible();
  await undo.click();
  await expect(clear).toBeVisible();
  await expect(save).toBeDisabled();
  await clear.click();
  await save.click();
  await expect(
    page.getByText('请输入 SMTP 密码，或清空 SMTP 用户名', { exact: true }),
  ).toBeVisible();
  await username.fill('');
  await saveAction('clear', false);
  await expect(clear).toBeDisabled();
});
