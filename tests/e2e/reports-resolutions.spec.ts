import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  OwnReportResponseSchema,
  ErrorResponseSchema,
  OwnReportRecordsResponseSchema,
} from '@personamarket/contracts';
import { createDatabase } from '@personamarket/database';
import { browserWrite, loginCreator } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { publishedVisualPersonas } from '../fixtures/visual-personas.js';

test.use({ trace: 'off', screenshot: 'off' });
test('分区和动作切换保留处置草稿，近期MFA验证后由本人重试，已提交断网不重复处置或通知', async ({
  page,
  browser,
}, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test'))
    throw Error('处置验收必须使用隔离数据库');
  const db = createDatabase(source);
  const options = {
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    viewport: page.viewportSize(),
  };
  const authorContext = await browser.newContext(options),
    readerContext = await browser.newContext(options);
  const author = await authorContext.newPage(),
    reader = await readerContext.newPage();
  const directory = join('data/tests/reports/resolutions', info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  try {
    await loginCreator(author);
    await loginCreator(reader);
    const admin = await loginBrowserAdmin(page);
    const works = await publishedVisualPersonas(author, page, {
      titles: {
        maibot: '举报处置的真实公开版本 ' + randomUUID().slice(0, 6),
        astrbot: '另一平台公开参照 ' + randomUUID().slice(0, 6),
      },
    });
    const details = '举报人私有线索，不向作品作者公开';
    const created = await browserWrite(
      reader,
      '/api/v1/reports',
      {
        target: { type: 'persona', personaId: works.maibot.id, releaseId: works.maibot.releaseId },
        reason: 'copyright',
        details,
      },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(created.status()).toBe(200);
    const report = OwnReportResponseSchema.parse(await created.json()).data;
    const path = '/api/v1/admin/reports/' + report.id + '/actions';
    await page.goto('/admin/reports?report=' + report.id);
    const panel = page.getByRole('dialog', { name: '处理举报', exact: true });
    await expect(panel.getByRole('tab', { name: '处理', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(panel.getByText(details, { exact: true })).toHaveCount(0);
    await panel.getByRole('button', { name: '完成处理', exact: true }).click();
    await panel.getByLabel('内容处置', { exact: true }).click();
    await page.getByRole('option', { name: '封禁所举报版本', exact: true }).click();
    const reason = '仅被处置者可见的版本处置原因';
    const message = '已核实并封禁所举报版本';
    const privateNote = '仅管理员可见的核验记录';
    await panel.getByLabel('被处置者可见说明', { exact: true }).fill(reason);
    await panel.getByLabel('举报人可见说明', { exact: true }).fill(message);
    await panel.getByLabel('仅管理员可见备注', { exact: true }).fill(privateNote);
    await panel.getByRole('tab', { name: '线索', exact: true }).click();
    await expect(panel).toContainText(details);
    await panel.getByRole('tab', { name: '记录', exact: true }).click();
    await expect(panel.getByRole('heading', { name: '处理记录', exact: true })).toBeVisible();
    await panel.getByRole('tab', { name: '处理', exact: true }).click();
    await expect(panel.getByLabel('被处置者可见说明', { exact: true })).toHaveValue(reason);
    await panel.getByRole('button', { name: '受理举报', exact: true }).click();
    await expect(panel.getByLabel('被处置者可见说明', { exact: true })).toHaveCount(0);
    await panel.getByRole('button', { name: '完成处理', exact: true }).click();
    await expect(panel.getByLabel('被处置者可见说明', { exact: true })).toHaveValue(reason);
    await expect(panel.getByLabel('内容处置', { exact: true })).toContainText('封禁所举报版本');
    await db.pool.query(
      "UPDATE auth_sessions SET mfa_verified_at=now()-interval '20 minutes',created_at=now()-interval '20 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
      [admin.username],
    );
    await panel.getByRole('button', { name: '核对处理操作', exact: true }).click();
    const confirmation = page.getByRole('alertdialog', { name: '确认完成处理', exact: true });
    await expect(confirmation).toContainText(reason);
    await expect(confirmation).toContainText('封禁所举报版本');
    await page.screenshot({ path: join(directory, 'resolution-confirmation.png') });
    const rejected = page.waitForResponse(
      (r) => new URL(r.url()).pathname === path && r.request().method() === 'POST',
    );
    await confirmation.getByRole('button', { name: '确认保存处理记录', exact: true }).click();
    const expired = await rejected;
    expect(expired.status()).toBe(403);
    expect(ErrorResponseSchema.parse(await expired.json()).error.code).toBe('MFA_REQUIRED');
    expect((await reader.request.get('/api/v1/personas/' + works.maibot.id)).status()).toBe(200);

    const verification = page.getByRole('dialog', { name: '验证高危操作', exact: true });
    await expect(verification).toBeVisible();
    await expect(panel).toHaveCount(0);
    // 验证输入不进入自动trace或截图；验证码只在此隔离场景使用
    await verification.getByLabel('动态验证码或恢复码', { exact: true }).fill(admin.recoveryCode);
    await verification.getByRole('button', { name: '确认身份', exact: true }).click();
    await expect(verification).not.toBeVisible();
    await expect(panel).toContainText('身份已确认');
    await expect(panel.getByLabel('举报人可见说明', { exact: true })).toHaveValue(message);
    await expect(panel.getByLabel('仅管理员可见备注', { exact: true })).toHaveValue(privateNote);
    await expect(panel.getByLabel('被处置者可见说明', { exact: true })).toHaveValue(reason);
    await page.route(
      '**' + path,
      async (route) => {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.abort('connectionreset');
      },
      { times: 1 },
    );
    async function save() {
      await panel.getByRole('button', { name: '核对处理操作', exact: true }).click();
      await page
        .getByRole('alertdialog', { name: '确认完成处理', exact: true })
        .getByRole('button', { name: '确认保存处理记录', exact: true })
        .click();
    }
    await save();
    await expect(panel).toContainText('当前输入已保留');
    await expect(panel.getByLabel('被处置者可见说明', { exact: true })).toHaveValue(reason);
    await save();
    await expect(panel).toContainText('处理记录已保存');
    const counts = (
      await db.pool.query(
        `SELECT
      (SELECT count(*)::int FROM report_resolutions x JOIN report_actions a ON a.id=x.action_id WHERE a.report_id=$1) AS receipts,
      (SELECT count(*)::int FROM moderation_records WHERE persona_id=$2 AND action='release_block') AS content,
      (SELECT count(*)::int FROM notifications n JOIN report_actions a ON a.id=n.source_id WHERE a.report_id=$1 AND n.kind='report_updated') AS notices`,
        [report.id, works.maibot.id],
      )
    ).rows;
    expect(counts).toEqual([{ receipts: 1, content: 1, notices: 1 }]);
    await expect
      .poll(
        async () =>
          Number(
            (
              await db.pool.query(
                "SELECT count(*)::int AS count FROM notifications n JOIN report_actions a ON a.id=n.source_id WHERE a.report_id=$1 AND n.kind='report_updated' AND n.status='delivered'",
                [report.id],
              )
            ).rows[0]?.count,
          ),
        { timeout: 10000 },
      )
      .toBe(1);
    expect(
      (
        await reader.request.get(
          '/api/v1/personas/' + works.maibot.id + '/releases/' + works.maibot.releaseId,
        )
      ).status(),
    ).toBe(404);
    await reader.goto('/dashboard/reports?report=' + report.id);
    const own = reader.getByRole('dialog', { name: '举报详情', exact: true });
    await own.getByRole('tab', { name: '记录', exact: true }).click();
    await expect(own).toContainText(message);
    await expect(own).toContainText('封禁所举报版本');
    await expect(own).not.toContainText(reason);
    await expect(own).not.toContainText(privateNote);
    const records = OwnReportRecordsResponseSchema.parse(
      await (await reader.request.get('/api/v1/me/reports/' + report.id + '/records')).json(),
    );
    expect(JSON.stringify(records)).not.toContain(reason);
    expect(JSON.stringify(records)).not.toContain(privateNote);
    await reader.screenshot({ path: join(directory, 'reporter-resolution-record.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await authorContext.close();
    await readerContext.close();
    await db.close();
  }
});
