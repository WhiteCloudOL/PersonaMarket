import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createDatabase } from '@personamarket/database';
import { createAdministrator } from '@personamarket/server';
import { AccountSettingsResponseSchema } from '@personamarket/contracts';

test.use({ trace: 'off', screenshot: 'off' });
test('管理员不绑定 MFA 即可使用后台，过期高危操作就地确认密码并保留输入', async ({ page }) => {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test')) throw new Error('必须使用隔离测试库');
  const database = createDatabase(source);
  const username = 'optional_' + randomUUID().replaceAll('-', '').slice(0, 12);
  const password = 'Optional browser administrator passphrase 2026';
  try {
    await createAdministrator(database, {
      username,
      email: username + '@fixture.invalid',
      password,
    });
    await page.goto('/login');
    await page.getByLabel('用户名或邮箱').fill(username);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole('tab', { name: '二次验证', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: '站点设置', exact: true }).click();
    await expect(page.getByRole('heading', { name: '站点展示' })).toBeVisible();
    await database.pool.query(
      "UPDATE auth_sessions SET created_at=now()-interval '11 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
      [username],
    );
    await page.goto('/admin/settings/accounts');
    const previous = AccountSettingsResponseSchema.parse(
      await (await page.request.get('/api/v1/admin/settings/accounts')).json(),
    );
    await page.getByRole('button', { name: '展开频率与会话设置', exact: true }).click();
    await page.getByLabel('新会话有效期（秒）', { exact: true }).fill('3600');
    await page.getByRole('button', { name: '保存注册设置', exact: true }).click();
    await page.getByRole('button', { name: '验证高危操作', exact: true }).click();
    const modal = page.getByRole('dialog', { name: '验证高危操作', exact: true });
    await modal.getByLabel('当前登录密码', { exact: true }).fill(password);
    await modal.getByRole('button', { name: '确认身份', exact: true }).click();
    await expect(modal).toBeHidden();
    await expect(page).toHaveURL(/\/admin\/settings\/accounts$/);
    await expect(page.getByLabel('新会话有效期（秒）', { exact: true })).toHaveValue('3600');
    const unchanged = AccountSettingsResponseSchema.parse(
      await (await page.request.get('/api/v1/admin/settings/accounts')).json(),
    );
    expect(unchanged.meta.revision).toBe(previous.meta.revision);
    await page.getByRole('button', { name: '保存注册设置', exact: true }).click();
    await expect(
      page.getByText('注册设置已保存，新注册和之后创建的完整会话使用当前策略', { exact: true }),
    ).toBeVisible();
    expect(
      AccountSettingsResponseSchema.parse(
        await (await page.request.get('/api/v1/admin/settings/accounts')).json(),
      ).data.sessionTtlSeconds,
    ).toBe(3600);
  } finally {
    await database.close();
  }
});
