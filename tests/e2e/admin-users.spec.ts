import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { createDatabase } from '@personamarket/database';
import { createAdministrator } from '@personamarket/server';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });

test('用户列表真实筛选、详情和返回在桌面与触控布局可用', async ({ page }, info) => {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test')) throw new Error('必须使用隔离测试库');
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  const database = createDatabase(source);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
  const username = 'manager_' + suffix;
  const targetName = 'managed_' + suffix;
  const password = 'User management browser fixture 2026';
  const evidence = join('data/tests/admin-users', info.project.name, randomUUID());
  try {
    for (const name of [username, targetName])
      await createAdministrator(database, {
        username: name,
        email: name + '@fixture.invalid',
        password,
      });
    await page.goto('/login');
    await page.getByLabel('用户名或邮箱').fill(username);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL(/\/account$/);
    await page.getByRole('button', { name: '打开账号菜单' }).click();
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: join(evidence, 'account-menu.png') });
    const response = await page.goto('/admin/users?q=' + targetName);
    await page.screenshot({
      path: join(evidence, response?.status() === 404 ? 'before.png' : 'initial.png'),
      fullPage: true,
    });
    await expect(page.getByRole('heading', { name: '用户管理', exact: true })).toBeVisible();
    await expect(page.getByLabel('搜索用户', { exact: true })).toHaveValue(targetName);
    await page.getByRole('button', { name: '管理 ' + targetName, exact: true }).click();
    await expect(page).toHaveURL(/userId=/);
    const panel = page.getByRole('dialog', { name: '用户详情', exact: true });
    await expect(panel.getByText(targetName + '@fixture.invalid', { exact: true })).toBeVisible();
    await page.screenshot({ path: join(evidence, 'detail.png') });
    await panel.getByRole('button', { name: '关闭详情', exact: true }).click();
    await expect(panel).toBeHidden();
    await expect(page).not.toHaveURL(/userId=/);
    await page.getByLabel('搜索用户', { exact: true }).fill('unknown_' + suffix);
    await page.getByRole('button', { name: '筛选用户', exact: true }).click();
    await expect(page.getByRole('heading', { name: '没有符合条件的用户' })).toBeVisible();
    await page.goBack();
    await expect(page.getByLabel('搜索用户', { exact: true })).toHaveValue(targetName);
    await expect(
      page.getByRole('button', { name: '管理 ' + targetName, exact: true }),
    ).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(evidence, 'list.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
  } finally {
    await database.close();
  }
});
