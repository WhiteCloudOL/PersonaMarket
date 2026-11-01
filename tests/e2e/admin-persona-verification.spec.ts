import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { createDatabase } from '@personamarket/database';
import {
  AdminPersonaResponseSchema,
  AuthContextResponseSchema,
  ErrorResponseSchema,
} from '@personamarket/contracts';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { visualPersonas } from '../fixtures/visual-personas.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });

test('本人作品只显示一份近期验证入口，在当前面板验证且保留未提交理由', async ({
  page,
  browser,
}, info) => {
  const source = process.env['TEST_DATABASE_URL'];
  const baseURL = process.env['PLAYWRIGHT_ORIGIN'];
  if (!source || !new URL(source).pathname.endsWith('_test') || !baseURL)
    throw new Error('必须使用隔离测试环境');
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  const database = createDatabase(source);
  const context = await browser.newContext({ baseURL });
  const reviewer = await context.newPage();
  const directory = join('data/tests/admin-persona-verification', info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  try {
    const administrator = await loginBrowserAdmin(page);
    await loginBrowserAdmin(reviewer);
    const works = await visualPersonas(page, reviewer);
    let attempts = 0;
    page.on('request', (request) => {
      if (
        request.url().endsWith('/admin/personas/' + works.maibot.id + '/curation') &&
        request.method() === 'PUT'
      )
        attempts++;
    });
    const actor = AuthContextResponseSchema.parse(
      await (await page.request.get('/api/v1/auth/context')).json(),
    ).data.account;
    if (!actor) throw new Error('管理员未登录');
    await database.pool.query(
      "UPDATE auth_sessions SET created_at=now()-interval '20 minutes',mfa_verified_at=now()-interval '20 minutes' WHERE user_id=$1",
      [actor.id],
    );
    await page.goto('/admin/personas?q=' + works.maibot.id);
    await page.getByRole('button', { name: '管理这条人设', exact: true }).click();
    const panel = page.getByRole('dialog', { name: '管理人设', exact: true });
    await panel.getByRole('checkbox', { name: '官方作品', exact: true }).check();
    await panel.getByRole('checkbox', { name: '我确认正在管理自己的作品', exact: true }).check();
    const reason = '本人作品的管理依据要在验证期间保留';
    await panel.getByLabel('处理理由', { exact: true }).fill(reason);
    const denied = page.waitForResponse(
      (response) =>
        response.url().endsWith('/admin/personas/' + works.maibot.id + '/curation') &&
        response.request().method() === 'PUT',
    );
    await panel.getByRole('button', { name: '保存标记', exact: true }).click();
    const result = await denied;
    expect(result.status()).toBe(403);
    expect(ErrorResponseSchema.parse(await result.json()).error.code).toBe('MFA_REQUIRED');
    await page.screenshot({ path: join(directory, 'verification.png'), fullPage: true });
    const entry = panel.getByRole('button', { name: '验证高危操作', exact: true });
    await expect(entry).toHaveCount(1);
    await entry.click();
    const verification = page.getByRole('dialog', { name: '验证高危操作', exact: true });
    await expect(verification.getByLabel('动态验证码或恢复码', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(verification).not.toBeVisible();
    await expect(panel.getByLabel('处理理由', { exact: true })).toHaveValue(reason);
    await expect(panel.getByRole('checkbox', { name: '官方作品', exact: true })).toBeChecked();
    await entry.click();
    await verification
      .getByLabel('动态验证码或恢复码', { exact: true })
      .fill(administrator.recoveryCode);
    await verification.getByRole('button', { name: '确认身份', exact: true }).click();
    await expect(verification).not.toBeVisible();
    await expect(
      panel.getByText('身份已确认，表单内容已保留，请重试刚才的操作', { exact: true }),
    ).toBeVisible();
    await expect(panel.getByLabel('处理理由', { exact: true })).toHaveValue(reason);
    expect(attempts).toBe(1);
    const retried = page.waitForResponse(
      (response) =>
        response.url().endsWith('/admin/personas/' + works.maibot.id + '/curation') &&
        response.request().method() === 'PUT',
    );
    await panel.getByRole('button', { name: '保存标记', exact: true }).click();
    expect((await retried).status()).toBe(200);
    await expect(panel.getByRole('button', { name: '关闭管理面板', exact: true })).toBeEnabled();
    expect(attempts).toBe(2);
    const current = await page.request.get('/api/v1/admin/personas/' + works.maibot.id);
    expect(current.status()).toBe(200);
    expect(AdminPersonaResponseSchema.parse(await current.json()).data.curation.official).toBe(
      true,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await context.close();
    await database.close();
  }
});
