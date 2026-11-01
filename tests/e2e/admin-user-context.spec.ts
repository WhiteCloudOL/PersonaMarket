import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { createDatabase } from '@personamarket/database';
import { AuthContextResponseSchema, CommentResponseSchema } from '@personamarket/contracts';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { browserWrite, loginCreator } from '../fixtures/browser-account.js';
import { visualPersonas } from '../fixtures/visual-personas.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });

test('用户详情切换公开作品和审核记录，真实归属、失败重试、键盘和未提交理由保留', async ({
  page,
  browser,
}, info) => {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test')) throw new Error('必须使用隔离测试库');
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  const database = createDatabase(source);
  const authorContext = await browser.newContext({
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
  });
  const author = await authorContext.newPage();
  const evidence = join('data/tests/admin-user-context', info.project.name, randomUUID());
  try {
    await loginBrowserAdmin(page);
    const creator = await loginCreator(author);
    const works = await visualPersonas(author, page);
    const created = await browserWrite(
      author,
      '/api/v1/personas/' + works.astrbot.id + '/comments',
      { body: '管理关联测试正文仅在评论详情读取' },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(created.status()).toBe(200);
    const comment = CommentResponseSchema.parse(await created.json()).data;
    const reviewReason = '用户评论的真实处理依据\n<img src=x onerror=alert(1)>';
    expect(
      (
        await browserWrite(
          page,
          '/api/v1/admin/comments/' + comment.id + '/review',
          {
            revisionId: comment.latest.id,
            expectedRevision: comment.revision,
            decision: 'approve',
            reason: reviewReason,
          },
          'POST',
          { 'Idempotency-Key': randomUUID() },
        )
      ).status(),
    ).toBe(200);
    const actor = AuthContextResponseSchema.parse(
      await (await page.request.get('/api/v1/auth/context')).json(),
    ).data.account;
    if (!actor) throw new Error('管理员未登录');
    await database.pool.query(
      "UPDATE auth_sessions SET created_at=now()-interval '20 minutes',mfa_verified_at=now()-interval '11 minutes' WHERE user_id=$1",
      [actor.id],
    );
    await page.goto('/admin/users?q=' + creator.username);
    await expect(
      page.getByRole('button', { name: '管理 ' + creator.username, exact: true }),
    ).toBeVisible();
    await mkdir(evidence, { recursive: true });
    await page.screenshot({
      path: join(evidence, 'list.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: '管理 ' + creator.username, exact: true }).click();
    const panel = page.getByRole('dialog', { name: '用户详情', exact: true });
    await expect(panel.getByText(creator.email, { exact: true })).toBeVisible();
    await page.screenshot({
      path: join(evidence, 'detail.png'),
    });
    await panel.getByRole('button', { name: '撤销会话', exact: true }).click();
    const reason = panel.getByLabel('处理理由', { exact: true });
    await reason.fill('切换关联内容仍保留未提交的账号处理理由');
    await panel.getByRole('tab', { name: '公开作品', exact: true }).click();
    await expect(page).toHaveURL(/userView=public/);
    const publicWorks = panel.getByRole('region', { name: '用户公开作品', exact: true });
    await expect(publicWorks.getByText(works.maibot.title, { exact: true })).toBeVisible();
    await expect(publicWorks.getByText(works.astrbot.title, { exact: true })).toBeVisible();
    await expect(publicWorks.locator('a[href="/personas/' + works.maibot.id + '"]')).toBeVisible();
    await page.screenshot({ path: join(evidence, 'public-personas.png') });
    const failPattern = '**/api/v1/admin/users/*/public-personas*';
    await page.route(failPattern, (route) => route.abort('failed'));
    await publicWorks.getByRole('button', { name: '刷新公开作品', exact: true }).click();
    await expect(
      publicWorks.getByRole('button', { name: '重试公开作品', exact: true }),
    ).toBeVisible();
    await page.unroute(failPattern);
    await publicWorks.getByRole('button', { name: '重试公开作品', exact: true }).click();
    await expect(
      publicWorks.getByRole('button', { name: '重试公开作品', exact: true }),
    ).toBeHidden();
    await expect(publicWorks.getByText(works.maibot.title, { exact: true })).toBeVisible();
    const recordTab = panel.getByRole('tab', { name: '审核记录', exact: true });
    await recordTab.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/userView=records/);
    const records = panel.getByRole('region', { name: '用户审核与处置记录', exact: true });
    await expect(records.getByText(reviewReason, { exact: true })).toBeVisible();
    await expect(records.locator('img')).toHaveCount(0);
    await expect(
      records.getByText('管理关联测试正文仅在评论详情读取', { exact: true }),
    ).toHaveCount(0);
    await records.getByRole('combobox', { name: '审核记录类别', exact: true }).click();
    await page.getByRole('option', { name: '评论记录', exact: true }).click();
    await expect(page).toHaveURL(/recordKind=comment/);
    await expect(
      records.locator('a[href="/admin/comments?commentId=' + comment.id + '"]'),
    ).toBeVisible();
    await page.screenshot({ path: join(evidence, 'comment-records.png') });
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await panel.getByRole('tab', { name: '管理操作', exact: true }).click();
    await expect(reason).toHaveValue('切换关联内容仍保留未提交的账号处理理由');
    expect((await author.request.get('/api/v1/auth/sessions')).status()).toBe(200);
  } finally {
    await authorContext.close();
    await database.close();
  }
});
