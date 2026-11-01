import { logoutAccount } from '../fixtures/account-navigation.js';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { createDatabase } from '@personamarket/database';
import { createAdministrator } from '@personamarket/server';
import { AdminUserResponseSchema } from '@personamarket/contracts';
import { browserWrite } from '../fixtures/browser-account.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });

async function login(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('用户名或邮箱').fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
}
async function fixture() {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test')) throw new Error('必须使用隔离测试库');
  const database = createDatabase(source);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
  const username = 'safe_' + suffix;
  const targetName = 'target_' + suffix;
  const password = 'Safe management browser fixture 2026';
  try {
    for (const name of [username, targetName])
      await createAdministrator(database, {
        username: name,
        email: name + '@fixture.invalid',
        password,
      });
    const rows = await database.pool.query<{ id: string; username: string }>(
      'SELECT id,username FROM users WHERE username=ANY($1::text[])',
      [[username, targetName]],
    );
    const actorId = rows.rows.find((row) => row.username === username)?.id;
    const targetId = rows.rows.find((row) => row.username === targetName)?.id;
    if (!actorId || !targetId) throw new Error('隔离测试账号不完整');
    return { database, username, targetName, password, actorId, targetId };
  } catch (cause) {
    await database.close();
    throw cause;
  }
}

test('高危操作就地确认不自动提交，并发冲突保留理由和选项，读取新状态后再重试', async ({
  page,
}, info) => {
  const f = await fixture();
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  try {
    await login(page, f.username, f.password);
    await page.goto('/admin/users?q=' + f.targetName + '&userId=' + f.targetId);
    const panel = page.getByRole('dialog', { name: '用户详情', exact: true });
    await panel.getByRole('combobox', { name: '新角色', exact: true }).click();
    await page.getByRole('option', { name: '审核员', exact: true }).click();
    const reason = panel.getByLabel('处理理由', { exact: true });
    await reason.fill('经核对授予审核角色，保留本页输入');
    await panel
      .getByRole('checkbox', { name: '我已核对账号、操作与影响范围', exact: true })
      .check();
    await f.database.pool.query(
      "UPDATE auth_sessions SET created_at=now()-interval '11 minutes' WHERE user_id=$1",
      [f.actorId],
    );
    await panel.getByRole('button', { name: '确认执行', exact: true }).click();
    await panel.getByRole('button', { name: '验证高危操作', exact: true }).click();
    const verification = page.getByRole('dialog', { name: '验证高危操作', exact: true });
    await verification.getByLabel('当前登录密码', { exact: true }).fill(f.password);
    await verification.getByRole('button', { name: '确认身份', exact: true }).click();
    await expect(verification).toBeHidden();
    await expect(reason).toHaveValue('经核对授予审核角色，保留本页输入');
    await expect(
      panel
        .getByRole('combobox', { name: '新角色', exact: true })
        .locator('[data-slot="select-value"]'),
    ).toHaveText('审核员');
    expect(
      (await f.database.pool.query('SELECT role FROM users WHERE id=$1', [f.targetId])).rows[0]
        ?.role,
    ).toBe('admin');
    await panel.getByRole('button', { name: '确认执行', exact: true }).click();
    await expect(
      panel.getByText('管理操作已保存，目标账号的会话状态已更新', { exact: true }),
    ).toBeVisible();
    await panel.getByRole('button', { name: '封禁账号', exact: true }).click();
    await reason.fill('仅封账号的并发核对理由');
    await panel
      .getByRole('checkbox', { name: '我已核对账号、操作与影响范围', exact: true })
      .check();
    const current = AdminUserResponseSchema.parse(
      await (await page.request.get('/api/v1/admin/users/' + f.targetId)).json(),
    ).data;
    expect(
      (
        await browserWrite(
          page,
          '/api/v1/admin/users/' + f.targetId + '/sessions',
          {
            expectedSecurityVersion: current.securityVersion,
            reason: '另一管理请求已处理会话',
          },
          'PUT',
          { 'Idempotency-Key': randomUUID() },
        )
      ).status(),
    ).toBe(200);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await panel.getByRole('button', { name: '确认执行', exact: true }).click();
    await expect(
      panel.getByText('用户状态已变化，输入已保留，请读取最新状态后核对', { exact: true }),
    ).toBeVisible();
    await expect(reason).toHaveValue('仅封账号的并发核对理由');
    await expect(
      panel
        .getByRole('combobox', { name: '封禁范围', exact: true })
        .locator('[data-slot="select-value"]'),
    ).toHaveText('仅封禁账号');
    await panel.getByRole('button', { name: '读取最新账号状态', exact: true }).click();
    await expect(
      panel.getByText('已读取最新账号状态，操作选项和理由已保留，请核对后重新提交', {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (await f.database.pool.query('SELECT status FROM users WHERE id=$1', [f.targetId])).rows[0]
        ?.status,
    ).toBe('active');
    await expect(reason).toHaveValue('仅封账号的并发核对理由');
    await panel.getByRole('button', { name: '确认执行', exact: true }).click();
    await expect(
      panel.getByText('管理操作已保存，目标账号的会话状态已更新', { exact: true }),
    ).toBeVisible();
    const after = AdminUserResponseSchema.parse(
      await (await page.request.get('/api/v1/admin/users/' + f.targetId)).json(),
    ).data;
    expect(after.status).toBe('banned');
    expect(after.role).toBe('moderator');
    expect(after.records.map((record) => record.action)).toEqual([
      'ban',
      'revoke_sessions',
      'set_role',
    ]);
    const evidence = join('data/tests/admin-users-security', info.project.name, randomUUID());
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: join(evidence, 'saved.png') });
  } finally {
    await f.database.close();
  }
});

test('管理输入在同账号会话恢复后保留，浏览器返回可继续，换号立即清除私有理由', async ({
  page,
  context,
}, info) => {
  const f = await fixture();
  const loginTab = await context.newPage();
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  try {
    await login(page, f.username, f.password);
    await page.goto('/admin/users?q=' + f.targetName);
    await page.getByRole('button', { name: '管理 ' + f.targetName, exact: true }).click();
    const panel = page.getByRole('dialog', { name: '用户详情', exact: true });
    const privateReason = '仅当前管理员可见的未提交理由_' + randomUUID();
    await panel.getByLabel('处理理由', { exact: true }).fill(privateReason);
    await page.goBack();
    await expect(panel).toBeHidden();
    await page.getByRole('button', { name: '继续用户操作', exact: true }).click();
    await expect(panel.getByLabel('处理理由', { exact: true })).toHaveValue(privateReason);
    await f.database.pool.query('UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1', [
      f.actorId,
    ]);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(
      page.getByRole('button', { name: '管理 ' + f.targetName, exact: true }),
    ).toBeHidden();
    await expect(panel).toBeHidden();
    await login(loginTab, f.username, f.password);
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(panel.getByLabel('处理理由', { exact: true })).toHaveValue(privateReason);
    await login(loginTab, f.targetName, f.password);
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page).toHaveURL(new RegExp('userId=' + f.targetId));
    await expect(
      page
        .getByRole('dialog', { name: '用户详情', exact: true })
        .getByLabel('处理理由', { exact: true }),
    ).toHaveValue('');
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(privateReason);
    await panel.getByLabel('处理理由', { exact: true }).fill('主动退出时清除的未提交理由');
    await logoutAccount(loginTab);
    await expect(loginTab).toHaveURL(/\/$/);
    await expect(panel).toBeHidden();
    await expect(page.getByText('主动退出时清除的未提交理由', { exact: true })).toHaveCount(0);
  } finally {
    await loginTab.close();
    await f.database.close();
  }
});
