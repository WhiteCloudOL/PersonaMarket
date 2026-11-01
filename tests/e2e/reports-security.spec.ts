import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createDatabase } from '@personamarket/database';
import { createAdministrator } from '@personamarket/server';
import {
  OwnReportResponseSchema,
  AdminReportRecordsResponseSchema,
} from '@personamarket/contracts';
import { loginCreator, browserWrite } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { publishedVisualPersonas } from '../fixtures/visual-personas.js';

test.use({ trace: 'off', screenshot: 'off' });
test('管理员自审在当前面板完成密码验证，确认过程保留公开说明和内部备注', async ({
  page,
  browser,
}) => {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test'))
    throw new Error('必须使用隔离举报测试库');
  const database = createDatabase(source),
    options = {
      baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
      viewport: page.viewportSize(),
    };
  const authorContext = await browser.newContext(options),
    reviewerContext = await browser.newContext(options);
  try {
    const author = await authorContext.newPage(),
      reviewer = await reviewerContext.newPage();
    await loginCreator(author);
    await loginBrowserAdmin(reviewer);
    const works = await publishedVisualPersonas(author, reviewer, {
      titles: {
        maibot: '管理员自审举报的真实作品 ' + randomUUID().slice(0, 8),
        astrbot: '自审隔离参照 ' + randomUUID().slice(0, 8),
      },
    });
    const username = 'report_admin_' + randomUUID().replaceAll('-', '').slice(0, 10),
      password = 'Report administrator browser passphrase 2026';
    await createAdministrator(database, {
      username,
      password,
      email: username + '@fixture.invalid',
    });
    await page.goto('/login');
    await page.getByLabel('用户名或邮箱').fill(username);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL(/\/account$/);
    const response = await browserWrite(
      page,
      '/api/v1/reports',
      {
        target: { type: 'persona', personaId: works.maibot.id },
        reason: 'other',
        details: '由管理员本人提交的受控举报',
      },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(response.status()).toBe(200);
    const report = OwnReportResponseSchema.parse(await response.json()).data;
    await database.pool.query(
      "UPDATE auth_sessions SET created_at=now()-interval '11 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
      [username],
    );
    await page.goto('/admin/reports?report=' + report.id);
    const panel = page.getByRole('dialog', { name: '处理举报', exact: true });
    await panel.getByLabel('举报人可见说明', { exact: true }).fill('保留这份公开处理说明');
    await panel.getByLabel('仅管理员可见备注', { exact: true }).fill('保留这份私有处理备注');
    await panel.getByRole('checkbox', { name: /我确认此举报涉及本人/ }).check();
    await panel.getByRole('button', { name: '核对处理操作', exact: true }).click();
    await page
      .getByRole('alertdialog', { name: '确认受理举报', exact: true })
      .getByRole('button', { name: '确认保存处理记录', exact: true })
      .click();
    await expect(panel.getByRole('button', { name: '验证高危操作', exact: true })).toBeVisible();
    await expect(panel.getByLabel('举报人可见说明', { exact: true })).toHaveValue(
      '保留这份公开处理说明',
    );
    await panel.getByRole('button', { name: '验证高危操作', exact: true }).click();
    const verification = page.getByRole('dialog', { name: '验证高危操作', exact: true });
    await verification.getByLabel('当前登录密码', { exact: true }).fill(password);
    await verification.getByRole('button', { name: '确认身份', exact: true }).click();
    await expect(verification).not.toBeVisible();
    await expect(panel).toContainText('身份已确认');
    await expect(panel.getByLabel('仅管理员可见备注', { exact: true })).toHaveValue(
      '保留这份私有处理备注',
    );
    await expect(panel.getByRole('checkbox', { name: /我确认此举报涉及本人/ })).toBeChecked();
    await panel.getByRole('button', { name: '核对处理操作', exact: true }).click();
    await page
      .getByRole('alertdialog', { name: '确认受理举报', exact: true })
      .getByRole('button', { name: '确认保存处理记录', exact: true })
      .click();
    await expect(panel).toContainText('处理记录已保存');
    const records = AdminReportRecordsResponseSchema.parse(
      await (await page.request.get('/api/v1/admin/reports/' + report.id + '/records')).json(),
    );
    expect(records.data.find((row) => row.action === 'accepted')).toMatchObject({
      selfReview: true,
      message: '保留这份公开处理说明',
      privateNote: '保留这份私有处理备注',
    });
  } finally {
    await database.close();
    await Promise.all([authorContext.close(), reviewerContext.close()]);
  }
});
