import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { createDatabase } from '@personamarket/database';
import { createAdministrator } from '@personamarket/server';
import { AdminUserResponseSchema, DeactivationResponseSchema } from '@personamarket/contracts';
import { browserWrite } from '../fixtures/browser-account.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });
async function login(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('用户名或邮箱').fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
}

test('待处理申请真实筛选，原文安全展示，近期验证保留决定，驳回与批准各作用于具体申请', async ({
  page,
  browser,
}, info) => {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test')) throw new Error('必须使用隔离测试库');
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  const database = createDatabase(source);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const username = 'reviewer_' + suffix;
  const targetName = 'applicant_' + suffix;
  const password = 'Browser request review fixture 2026';
  const applicantContext = await browser.newContext({
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
  });
  const applicant = await applicantContext.newPage();
  const evidence = join('data/tests/admin-deactivation', info.project.name, randomUUID());
  const requestReason =
    '本人申请暂停使用\n<img src="x" onerror="window.__deactivation_xss=1">\n保留作品与原始申请';
  try {
    for (const name of [username, targetName])
      await createAdministrator(database, {
        username: name,
        email: name + '@fixture.invalid',
        password,
      });
    await login(applicant, targetName, password);
    expect(
      (
        await browserWrite(applicant, '/api/v1/me/security/deactivation', {
          currentPassword: password,
          confirmation: '申请停用',
          reason: requestReason,
        })
      ).status(),
    ).toBe(200);
    const application = DeactivationResponseSchema.parse(
      await (await applicant.request.get('/api/v1/me/security/deactivation')).json(),
    ).data.request;
    if (!application) throw new Error('申请没有保存');
    await login(page, username, password);
    await page.goto('/admin/users?q=' + targetName);
    await expect(page.getByRole('heading', { name: '用户管理', exact: true })).toBeVisible();
    await mkdir(evidence, { recursive: true });
    const hasFilter = await page.locator('#admin-users-deactivation').count();
    await page.screenshot({
      path: join(evidence, hasFilter ? 'current-list.png' : 'before-list.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: '管理 ' + targetName, exact: true }).click();
    const panel = page.getByRole('dialog', { name: '用户详情', exact: true });
    await expect(panel.getByText(targetName + '@fixture.invalid', { exact: true })).toBeVisible();
    await page.screenshot({
      path: join(evidence, hasFilter ? 'current-detail.png' : 'before-detail.png'),
    });
    await panel.getByRole('button', { name: '关闭详情', exact: true }).click();
    await expect(panel).toBeHidden();
    await expect(page).not.toHaveURL(/userId=/);
    const more = page.getByRole('button', { name: '更多筛选', exact: true });
    await expect(more).toBeVisible();
    await more.click();
    await expect(page.getByRole('button', { name: '收起筛选', exact: true })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await page.screenshot({ path: join(evidence, 'expanded-filters.png'), fullPage: true });
    await page.getByRole('combobox', { name: '停用申请', exact: true }).click();
    await page.getByRole('option', { name: '待处理申请', exact: true }).click();
    await page.getByRole('button', { name: '筛选用户', exact: true }).click();
    await expect(page).toHaveURL(/deactivation=pending/);
    await page.getByRole('button', { name: '管理 ' + targetName, exact: true }).click();
    await panel.getByRole('button', { name: '处理停用申请', exact: true }).click();
    const original = panel.getByRole('region', { name: '当前停用申请', exact: true });
    await expect(original.getByText(requestReason, { exact: true })).toBeVisible();
    await expect(original.locator('img')).toHaveCount(0);
    expect(await page.evaluate(() => Object.hasOwn(window, '__deactivation_xss'))).toBe(false);
    await panel.getByRole('combobox', { name: '处理决定', exact: true }).click();
    await page.getByRole('option', { name: '驳回申请', exact: true }).click();
    const reason = panel.getByLabel('处理理由', { exact: true });
    await reason.fill('核对后需要本人重新确认，保留本页决定');
    await panel
      .getByRole('checkbox', { name: '我已核对账号、操作与影响范围', exact: true })
      .check();
    await page.screenshot({ path: join(evidence, 'review-application.png') });
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await database.pool.query(
      "UPDATE auth_sessions SET created_at=now()-interval '11 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
      [username],
    );
    await panel.getByRole('button', { name: '确认执行', exact: true }).click();

    const verification = page.getByRole('dialog', { name: '验证高危操作', exact: true });
    await verification.getByLabel('当前登录密码', { exact: true }).fill(password);
    await verification.getByRole('button', { name: '确认身份', exact: true }).click();
    await expect(verification).toBeHidden();
    await expect(reason).toHaveValue('核对后需要本人重新确认，保留本页决定');
    expect(
      (
        await database.pool.query('SELECT status FROM deactivation_requests WHERE id=$1', [
          application.id,
        ])
      ).rows[0]?.status,
    ).toBe('pending');
    await panel.getByRole('button', { name: '确认执行', exact: true }).click();
    await expect(
      panel.getByText('停用申请已驳回，账号保持当前状态', { exact: true }),
    ).toBeVisible();
    expect(
      DeactivationResponseSchema.parse(
        await (await applicant.request.get('/api/v1/me/security/deactivation')).json(),
      ).data.request?.status,
    ).toBe('rejected');
    expect(
      (
        await browserWrite(applicant, '/api/v1/me/security/deactivation', {
          currentPassword: password,
          confirmation: '申请停用',
          reason: '本人核对后再次申请',
        })
      ).status(),
    ).toBe(200);
    await panel.getByRole('button', { name: '读取最新账号状态', exact: true }).click();
    await expect(
      panel.getByText('已读取最新账号状态，操作选项和理由已保留，请核对后重新提交', {
        exact: true,
      }),
    ).toBeVisible();
    await panel.getByRole('button', { name: '处理停用申请', exact: true }).click();
    await expect(
      panel
        .getByRole('combobox', { name: '处理决定', exact: true })
        .locator('[data-slot="select-value"]'),
    ).toHaveText('批准停用');
    await reason.fill('确认本人第二次申请，仅停用账号');
    await panel
      .getByRole('checkbox', { name: '我已核对账号、操作与影响范围', exact: true })
      .check();
    await panel.getByRole('button', { name: '确认执行', exact: true }).click();
    await expect(panel.getByText('停用申请已批准，账号已停用', { exact: true })).toBeVisible();
    expect((await applicant.request.get('/api/v1/auth/sessions')).status()).toBe(401);
    const ids = await database.pool.query<{ id: string }>(
      'SELECT id FROM users WHERE username=$1',
      [targetName],
    );
    const id = ids.rows[0]?.id;
    if (!id) throw new Error('目标用户不存在');
    const detail = AdminUserResponseSchema.parse(
      await (await page.request.get('/api/v1/admin/users/' + id)).json(),
    ).data;
    expect(detail.status).toBe('deactivated');
    expect(detail.deactivationRequests.map((request) => request.status)).toEqual([
      'approved',
      'rejected',
    ]);
    expect(detail.deactivationRequests[0]?.decision?.actor.username).toBe(username);
    const history = panel.getByRole('region', { name: '停用申请记录', exact: true });
    await history.scrollIntoViewIfNeeded();
    await expect(history).toContainText('确认本人第二次申请，仅停用账号');
    await expect(history).toContainText('核对后需要本人重新确认，保留本页决定');
    await page.screenshot({ path: join(evidence, 'processed-detail.png') });
  } finally {
    await applicantContext.close();
    await database.close();
  }
});
