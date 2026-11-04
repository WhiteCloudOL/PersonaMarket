import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  AdminCommentResponseSchema,
  BulkReviewCommentsResponseSchema,
  CommentResponseSchema,
  EditCommentSchema,
  ErrorResponseSchema,
  PublicCommentsResponseSchema,
} from '@personamarket/contracts';
import { createDatabase } from '@personamarket/database';
import { createAdministrator } from '@personamarket/server';
import { loginCreator, browserWrite } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { visualPersonas } from '../fixtures/visual-personas.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });
let authorContext: BrowserContext;
let adminContext: BrowserContext;
let author: Page;
let admin: Page;
let works: Awaited<ReturnType<typeof visualPersonas>>;
test.beforeAll(async ({ browser }, info) => {
  const viewport =
    info.project.name === 'desktop' ? { width: 1440, height: 900 } : info.project.use.viewport;
  const options = {
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    ...(viewport ? { viewport } : {}),
    hasTouch: info.project.use.hasTouch ?? false,
    isMobile: info.project.use.isMobile ?? false,
    deviceScaleFactor: info.project.use.deviceScaleFactor ?? 1,
  };
  authorContext = await browser.newContext(options);
  adminContext = await browser.newContext(options);
  author = await authorContext.newPage();
  await author.clock.install();
  admin = await adminContext.newPage();
  await loginCreator(author);
  await loginBrowserAdmin(admin);
  works = await visualPersonas(author, admin, {
    titles: {
      maibot: '评论测试的书房星光 ' + randomUUID().slice(0, 8),
      astrbot: '评论测试的旅途来信 ' + randomUUID().slice(0, 8),
    },
  });
});

test('批量失败条目已由他人审核后，读取最新状态清除不再相关的身份验证提示', async ({ page }) => {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test'))
    throw new Error('评论批量身份验证仅允许隔离测试库');
  const database = createDatabase(source);
  const username = 'bulk_admin_' + randomUUID().replaceAll('-', '').slice(0, 12);
  const password = 'Comment bulk browser fixture passphrase 2026';
  try {
    await createAdministrator(database, {
      username,
      email: username + '@fixture.invalid',
      password,
    });
    expect(
      (await browserWrite(page, '/api/v1/auth/login', { identifier: username, password })).status(),
    ).toBe(200);
    const created = await browserWrite(
      page,
      '/api/v1/personas/' + works.astrbot.id + '/comments',
      { body: '批量审核中的管理员本人评论 ' + randomUUID().slice(0, 8) },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(created.status()).toBe(200);
    const row = CommentResponseSchema.parse(await created.json()).data;
    await database.pool.query(
      "UPDATE auth_sessions SET created_at=now()-interval '11 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
      [username],
    );
    await page.goto('/admin/comments?personaId=' + works.astrbot.id);
    await page
      .locator('[aria-label="评论审核记录"]')
      .filter({ hasText: row.latest.body })
      .getByRole('checkbox', { name: '选择当前文本', exact: true })
      .check();
    await page.getByRole('button', { name: '批量审核所选评论', exact: true }).click();
    const panel = page.getByRole('dialog', { name: '批量审核评论', exact: true });
    await panel.getByLabel('批量审核理由', { exact: true }).fill('核对本人评论并明确申请自审');
    await panel.getByRole('checkbox', { name: /涉及本人评论时/ }).check();
    await panel.getByRole('button', { name: '核对并处理 1 条评论', exact: true }).click();
    const request = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/admin/comments/bulk-review' &&
        response.request().method() === 'POST',
    );
    await page
      .getByRole('alertdialog', { name: '确认批量处理 1 条评论', exact: true })
      .getByRole('button', { name: '确认批量处理', exact: true })
      .click();
    const result = await request;
    expect(result.status()).toBe(200);
    expect(BulkReviewCommentsResponseSchema.parse(await result.json()).data).toMatchObject([
      { id: row.id, ok: false, error: { code: 'REAUTH_REQUIRED' } },
    ]);
    const verification = page.getByRole('dialog', { name: '验证高危操作', exact: true });
    await expect(verification).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(verification).toBeHidden();
    const approved = await browserWrite(
      admin,
      '/api/v1/admin/comments/' + row.id + '/review',
      { revisionId: row.latest.id, expectedRevision: row.revision, decision: 'approve' },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(approved.status()).toBe(200);
    await panel.getByRole('button', { name: '读取失败条目最新快照', exact: true }).click();
    await expect(panel.getByRole('button', { name: '返回审核队列', exact: true })).toBeVisible();
    await expect(verification).toHaveCount(0);
    await expect(panel.getByRole('button', { name: /^核对并处理/ })).toHaveCount(0);
    await expect(panel.getByLabel('批量审核结果')).toContainText('未完成');
  } finally {
    await database.close();
  }
});
test.afterAll(async () => {
  try {
    if (works)
      for (const work of [works.maibot, works.astrbot])
        expect(
          (
            await browserWrite(author, '/api/v1/me/personas/' + work.id + '/visibility', {
              visibility: 'hidden',
              reason: '结束隔离评论浏览器验收',
            })
          ).status(),
        ).toBe(200);
  } finally {
    await Promise.all([authorContext?.close(), adminContext?.close()]);
  }
});

async function approvedComment(body: string) {
  const created = await browserWrite(
    author,
    '/api/v1/personas/' + works.maibot.id + '/comments',
    { body },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(created.status()).toBe(200);
  const row = CommentResponseSchema.parse(await created.json()).data;
  const response = await browserWrite(
    admin,
    '/api/v1/admin/comments/' + row.id + '/review',
    { revisionId: row.latest.id, expectedRevision: row.revision, decision: 'approve', reason: '' },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(response.status()).toBe(200);
  return AdminCommentResponseSchema.parse(await response.json()).data;
}

test('双窗口编辑冲突保留输入，重连刷新不能悄悄更新保存修订号', async ({ browserName }, info) => {
  info.annotations.push({ type: 'browser', description: browserName });
  const row = await approvedComment('并发编辑原文 ' + randomUUID().slice(0, 8));
  await author.goto('/personas/' + works.maibot.id + '#comments');
  await author
    .locator('[aria-label="评论楼层"]')
    .filter({ hasText: row.latest.body })
    .getByRole('button', { name: '管理这条评论', exact: true })
    .click();
  const panel = author.getByRole('dialog', { name: '管理我的评论', exact: true });
  const input = panel.getByLabel('修改评论', { exact: true });
  await expect(input).toHaveValue(row.latest.body);
  const retained = '当前窗口未提交的修改 ' + randomUUID().slice(0, 8);
  await input.fill(retained);
  const background = await authorContext.newPage();
  try {
    await background.goto('/account');
    const response = await browserWrite(
      background,
      '/api/v1/comments/' + row.id,
      { body: '另一窗口已提交的新文本', expectedRevision: row.revision },
      'PATCH',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(response.status()).toBe(200);
    const latest = CommentResponseSchema.parse(await response.json()).data;
    const refetched = author.waitForResponse(
      (result) =>
        new URL(result.url()).pathname === '/api/v1/me/comments/' + row.id &&
        result.request().method() === 'GET',
    );
    await author.bringToFront();
    // 仓库关闭窗口聚焦刷新；用真实离线/重连及受控客户端时间使30秒缓存过期
    await author.clock.fastForward(31_000);
    await authorContext.setOffline(true);
    await authorContext.setOffline(false);
    const actual = CommentResponseSchema.parse(await (await refetched).json()).data;
    expect(actual.revision).toBe(latest.revision);
    await expect(input).toHaveValue(retained);
    const saving = author.waitForResponse(
      (result) =>
        new URL(result.url()).pathname === '/api/v1/comments/' + row.id &&
        result.request().method() === 'PATCH',
    );
    await panel.getByRole('button', { name: '提交修改', exact: true }).click();
    const saved = await saving;
    const size = author.viewportSize();
    if (!size) throw new Error('缺少浏览器视口');
    const directory = join('data/tests/comments/race', `${size.width}x${size.height}`);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'result.json'),
      JSON.stringify(
        {
          originalRevision: row.revision,
          backgroundRevision: latest.revision,
          submittedExpectedRevision: EditCommentSchema.parse(saved.request().postDataJSON())
            .expectedRevision,
          status: saved.status(),
        },
        null,
        2,
      ),
    );
    await author.screenshot({ path: join(directory, 'after-first-save.png') });
    expect(saved.status()).toBe(412);
    await expect(input).toHaveValue(retained);
    await expect(panel.getByText('当前输入已保留', { exact: false })).toBeVisible();
    const reloading = author.waitForResponse(
      (result) =>
        new URL(result.url()).pathname === '/api/v1/me/comments/' + row.id &&
        result.request().method() === 'GET',
    );
    await panel.getByRole('button', { name: '读取最新评论', exact: true }).click();
    expect((await reloading).status()).toBe(200);
    await expect(input).toHaveValue(retained);
    const retry = author.waitForResponse(
      (result) =>
        new URL(result.url()).pathname === '/api/v1/comments/' + row.id &&
        result.request().method() === 'PATCH',
    );
    await panel.getByRole('button', { name: '提交修改', exact: true }).click();
    expect((await retry).status()).toBe(200);
    await expect(panel).not.toBeVisible();
    await expect(author.locator('#my-comments')).toContainText(retained);
    await expect(
      author.locator('[aria-label="评论楼层"]').filter({ hasText: row.latest.body }),
    ).toBeVisible();
    await author.evaluate(() => scrollTo(0, 0));
    await author.screenshot({ path: join(directory, 'after-retry.png'), fullPage: true });
    await info.attach('comment-edit-race', {
      path: join(directory, 'result.json'),
      contentType: 'application/json',
    });
  } finally {
    await authorContext.setOffline(false);
    await background.close();
  }
});

test('未绑定MFA的管理员评论自审在原页面密码确认，保留理由与快照后手动重试', async ({
  page,
}, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test'))
    throw new Error('评论自审仅允许隔离测试库');
  const database = createDatabase(source);
  const username = 'comment_admin_' + randomUUID().replaceAll('-', '').slice(0, 12);
  const password = 'Comment self review browser fixture passphrase 2026';
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
    const created = await browserWrite(
      page,
      '/api/v1/personas/' + works.astrbot.id + '/comments',
      { body: '管理员自己的待审评论 ' + randomUUID().slice(0, 8) },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(created.status()).toBe(200);
    const row = CommentResponseSchema.parse(await created.json()).data;
    await database.pool.query(
      "UPDATE auth_sessions SET created_at=now()-interval '11 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
      [username],
    );
    const path = '/admin/comments?personaId=' + works.astrbot.id + '&commentId=' + row.id;
    await page.goto(path);
    const panel = page.getByRole('dialog', { name: '评论审核详情', exact: true });
    await expect(panel).toContainText(row.latest.body);
    const reason = '核实本人评论后明确自审，当前页面保留此理由';
    await panel.getByLabel('审核或处置理由', { exact: true }).fill(reason);
    const confirmation = panel.getByRole('checkbox', { name: /我确认以管理员身份处理本人评论/ });
    await confirmation.check();
    const reviewPath = '/api/v1/admin/comments/' + row.id + '/review';
    const blocked = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === reviewPath && response.request().method() === 'POST',
    );
    await panel.getByRole('button', { name: '通过评论', exact: true }).click();
    const rejected = await blocked;
    expect(rejected.status()).toBe(403);
    expect(ErrorResponseSchema.parse(await rejected.json()).error.code).toBe('REAUTH_REQUIRED');
    await expect(page.getByRole('dialog', { name: '验证高危操作', exact: true })).toHaveCount(1);

    const verification = page.getByRole('dialog', { name: '验证高危操作', exact: true });
    const size = page.viewportSize();
    if (!size) throw new Error('缺少浏览器视口');
    const directory = join('data/tests/comments/current', `${size.width}x${size.height}`);
    await mkdir(directory, { recursive: true });
    // 只记录空白验证表单，输入密码后不采集截图或trace
    await page.screenshot({ path: join(directory, 'self-review-verification-empty.png') });
    await verification.getByLabel('当前登录密码', { exact: true }).fill(password);
    await verification.getByRole('button', { name: '确认身份', exact: true }).click();
    await expect(verification).toBeHidden();
    await expect(page).toHaveURL(path);
    await expect(panel.getByLabel('审核或处置理由', { exact: true })).toHaveValue(reason);
    await expect(confirmation).toBeChecked();
    const stillPending = await database.pool.query<{ status: string }>(
      'SELECT status FROM comment_revisions WHERE id=$1',
      [row.latest.id],
    );
    expect(stillPending.rows[0]?.status).toBe('PENDING');
    const approving = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === reviewPath && response.request().method() === 'POST',
    );
    await panel.getByRole('button', { name: '通过评论', exact: true }).click();
    expect((await approving).status()).toBe(200);
    await expect(panel.getByText('审核决定已保存', { exact: true })).toBeVisible();
    await page.screenshot({ path: join(directory, 'self-review-approved.png') });
    const publicResult = await page.request.get(
      '/api/v1/personas/' + works.astrbot.id + '/comments',
    );
    expect(PublicCommentsResponseSchema.parse(await publicResult.json()).data).toContainEqual(
      expect.objectContaining({ body: row.latest.body, status: 'published' }),
    );
  } finally {
    await database.close();
  }
});
