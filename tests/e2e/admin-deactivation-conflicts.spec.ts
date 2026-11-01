import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { createDatabase } from '@personamarket/database';
import { createAdministrator } from '@personamarket/server';
import { DeactivationResponseSchema } from '@personamarket/contracts';
import { browserWrite } from '../fixtures/browser-account.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });

async function login(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('用户名或邮箱').fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
}

test('撤回后的旧审核保留理由且不能转移到新申请，必须明确选择并重新确认', async ({
  page,
  browser,
}, info) => {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test')) throw new Error('必须使用隔离测试库');
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  const database = createDatabase(source);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const managerName = 'conflict_reviewer_' + suffix;
  const applicantName = 'conflict_applicant_' + suffix;
  const password = 'Application conflict fixture 2026';
  const context = await browser.newContext({
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
  });
  const applicant = await context.newPage();
  try {
    for (const username of [managerName, applicantName])
      await createAdministrator(database, {
        username,
        email: username + '@fixture.invalid',
        password,
      });
    await login(applicant, applicantName, password);
    async function apply(reason: string) {
      expect(
        (
          await browserWrite(applicant, '/api/v1/me/security/deactivation', {
            currentPassword: password,
            confirmation: '申请停用',
            reason,
          })
        ).status(),
      ).toBe(200);
      const application = DeactivationResponseSchema.parse(
        await (await applicant.request.get('/api/v1/me/security/deactivation')).json(),
      ).data.request;
      if (!application) throw new Error('申请未保存');
      return application;
    }
    const original = await apply('第一份申请原文，不得用于第二份申请');
    await login(page, managerName, password);
    await page.goto('/admin/users?q=' + applicantName);
    await page.getByRole('button', { name: '管理 ' + applicantName, exact: true }).click();
    const panel = page.getByRole('dialog', { name: '用户详情', exact: true });
    await panel.getByRole('button', { name: '处理停用申请', exact: true }).click();
    const reason = panel.getByLabel('处理理由', { exact: true });
    await reason.fill('只针对第一份原始申请的核对理由');
    const confirmed = panel.getByRole('checkbox', {
      name: '我已核对账号、操作与影响范围',
      exact: true,
    });
    await confirmed.check();
    expect(
      (
        await browserWrite(applicant, '/api/v1/me/security/deactivation', undefined, 'DELETE')
      ).status(),
    ).toBe(200);
    const next = await apply('第二份全新申请，需要独立确认');
    expect(next.id).not.toBe(original.id);
    const response = page.waitForResponse(
      (response) =>
        response.url().includes('/deactivation-requests/' + original.id + '/review') &&
        response.request().method() === 'POST',
    );
    await panel.getByRole('button', { name: '确认执行', exact: true }).click();
    expect((await response).status()).toBe(409);
    await expect(
      panel.getByText('申请已撤回或已处理，请读取最新账号状态', { exact: true }),
    ).toBeVisible();
    await expect(reason).toHaveValue('只针对第一份原始申请的核对理由');
    expect((await database.pool.query('SELECT id FROM deactivation_decisions')).rowCount).toBe(0);
    await panel.getByRole('button', { name: '读取最新账号状态', exact: true }).click();
    await expect(
      panel.getByText('所选申请已撤回或已处理，请重新选择', { exact: true }),
    ).toBeVisible();
    await expect(panel.getByRole('region', { name: '当前停用申请', exact: true })).toContainText(
      original.reason,
    );
    await expect(panel.getByRole('button', { name: '确认执行', exact: true })).toBeDisabled();
    await expect(reason).toHaveValue('只针对第一份原始申请的核对理由');
    await panel.getByRole('combobox', { name: '待处理申请', exact: true }).click();
    await page.getByRole('option').click();
    await expect(panel.getByRole('region', { name: '当前停用申请', exact: true })).toContainText(
      next.reason,
    );
    await expect(confirmed).not.toBeChecked();
    await reason.fill('核对第二份原文后的新处理理由');
    await confirmed.check();
    await panel.getByRole('button', { name: '确认执行', exact: true }).click();
    await expect(panel.getByText('停用申请已批准，账号已停用', { exact: true })).toBeVisible();
    expect(
      (await database.pool.query('SELECT application_id,reason FROM deactivation_decisions')).rows,
    ).toEqual([{ application_id: next.id, reason: '核对第二份原文后的新处理理由' }]);
    expect(
      (
        await database.pool.query('SELECT status FROM deactivation_requests WHERE id=$1', [
          original.id,
        ])
      ).rows[0]?.status,
    ).toBe('withdrawn');
    expect((await applicant.request.get('/api/v1/auth/sessions')).status()).toBe(401);
    const evidence = join(
      'data/tests/admin-deactivation-conflicts',
      info.project.name,
      randomUUID(),
    );
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: join(evidence, 'explicit-next-application.png') });
  } finally {
    await context.close();
    await database.close();
  }
});
