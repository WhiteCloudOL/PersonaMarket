import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createDatabase } from '@personamarket/database';
import {
  BulkReviewCommentsResponseSchema,
  CommentResponseSchema,
  PublicCommentsResponseSchema,
} from '@personamarket/contracts';
import { browserWrite, loginCreator } from '../fixtures/browser-account.js';
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
  admin = await adminContext.newPage();
  await loginCreator(author);
  await loginBrowserAdmin(admin);
  works = await visualPersonas(author, admin, {
    titles: {
      maibot: '批量评论审核 ' + randomUUID().slice(0, 8),
      astrbot: '审核队列参照 ' + randomUUID().slice(0, 8),
    },
  });
});
test.afterAll(async () => {
  try {
    if (works)
      for (const work of [works.maibot, works.astrbot])
        expect(
          (
            await browserWrite(author, '/api/v1/me/personas/' + work.id + '/visibility', {
              visibility: 'hidden',
              reason: '结束隔离评论批量审核验收',
            })
          ).status(),
        ).toBe(200);
  } finally {
    await Promise.all([authorContext?.close(), adminContext?.close()]);
  }
});

test('批量确认逐项返回并发失败，读取失败快照保留理由，重试不重复处理已成功条目', async ({
  browserName,
}, info) => {
  info.annotations.push({ type: 'browser', description: browserName });
  const rows = [];
  for (const body of [
    '第一条人工核对的评论',
    '第二条将发生并发修改的评论',
    '第三条保持待审不可公开',
  ]) {
    const response = await browserWrite(
      author,
      '/api/v1/personas/' + works.maibot.id + '/comments',
      { body: body + ' ' + randomUUID().slice(0, 8) },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(response.status()).toBe(200);
    rows.push(CommentResponseSchema.parse(await response.json()).data);
  }
  const [first, second, privateRow] = rows;
  if (!first || !second || !privateRow) throw new Error('缺少受控审核数据');
  await admin.goto('/admin/comments?personaId=' + works.maibot.id);
  const firstCheckbox = admin.getByRole('checkbox', { name: '选择当前文本', exact: true }).first();
  await expect(firstCheckbox).toBeVisible();
  const hitTarget = await firstCheckbox.evaluate((element) => {
    const label =
      element.closest('label') ?? element.closest('[data-slot="field"]')?.querySelector('label');
    const bounds = label?.getBoundingClientRect();
    return bounds ? { width: bounds.width, height: bounds.height } : null;
  });
  const size = admin.viewportSize();
  if (!size) throw new Error('缺少浏览器视口');
  const directory = join('data/tests/comments/current', `${size.width}x${size.height}`);
  await mkdir(directory, { recursive: true });
  await admin.evaluate(() => scrollTo(0, 0));
  await admin.screenshot({
    path: join(directory, 'moderation-targets-before.png'),
    fullPage: true,
  });
  expect(hitTarget?.height, '评论选择标签应有至少44px的连续触控区域').toBeGreaterThanOrEqual(44);
  expect(hitTarget?.width).toBeGreaterThanOrEqual(44);
  for (const row of [first, second])
    await admin
      .locator('[aria-label="评论审核记录"]')
      .filter({ hasText: row.latest.body })
      .getByRole('checkbox', { name: '选择当前文本', exact: true })
      .check();
  await admin.getByRole('button', { name: '批量审核所选评论', exact: true }).click();
  const panel = admin.getByRole('dialog', { name: '批量审核评论', exact: true });
  await expect(panel).toContainText(first.latest.body);
  await expect(panel).toContainText(second.latest.body);
  const close = panel.getByRole('button', { name: '关闭', exact: true });
  expect((await close.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect((await close.boundingBox())?.width).toBeGreaterThanOrEqual(44);
  const reason = '逐项核对文字与状态后进行批量审核';
  await panel.getByLabel('批量审核理由', { exact: true }).fill(reason);
  const editedBody = '第二条已在另一窗口修改，需要重新核对';
  const edited = await browserWrite(
    author,
    '/api/v1/comments/' + second.id,
    { body: editedBody, expectedRevision: second.revision },
    'PATCH',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(edited.status()).toBe(200);
  const bulkPath = '/api/v1/admin/comments/bulk-review';
  await panel.getByRole('button', { name: '核对并处理 2 条评论', exact: true }).click();
  let confirmation = admin.getByRole('alertdialog', { name: '确认批量处理 2 条评论', exact: true });
  const firstRequest = admin.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === bulkPath && response.request().method() === 'POST',
  );
  await confirmation.getByRole('button', { name: '确认批量处理', exact: true }).click();
  const firstResponse = await firstRequest;
  expect(firstResponse.status()).toBe(200);
  const result = BulkReviewCommentsResponseSchema.parse(await firstResponse.json()).data;
  expect(result.map((item) => item.ok)).toEqual([true, false]);
  expect(result[1]).toMatchObject({ id: second.id, error: { code: 'REVISION_CONFLICT' } });
  await expect(panel.getByText('已处理 1 条，1 条未完成', { exact: true })).toBeVisible();
  await expect(panel.getByLabel('批量审核理由', { exact: true })).toHaveValue(reason);
  await panel.getByRole('button', { name: '读取失败条目最新快照', exact: true }).click();
  await expect(panel).toContainText(editedBody);
  await expect(panel.getByLabel('批量审核理由', { exact: true })).toHaveValue(reason);
  await panel.getByRole('button', { name: '核对并处理 1 条评论', exact: true }).click();
  confirmation = admin.getByRole('alertdialog', { name: '确认批量处理 1 条评论', exact: true });
  const retrying = admin.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === bulkPath && response.request().method() === 'POST',
  );
  await confirmation.getByRole('button', { name: '确认批量处理', exact: true }).click();
  const retry = await retrying;
  expect(retry.status()).toBe(200);
  const retried = BulkReviewCommentsResponseSchema.parse(await retry.json()).data;
  expect(retried).toHaveLength(1);
  expect(retried[0]).toMatchObject({ id: second.id, ok: true });
  await expect(panel.getByText('已处理 1 条，0 条未完成', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '返回审核队列', exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(admin.locator('[aria-label="评论审核记录"]')).toHaveCount(1);
  const publicResponse = await author.request.get(
    '/api/v1/personas/' + works.maibot.id + '/comments',
  );
  const published = PublicCommentsResponseSchema.parse(await publicResponse.json());
  expect(published.data.map((row) => row.id).sort()).toEqual([first.id, second.id].sort());
  expect(JSON.stringify(published)).not.toContain(privateRow.latest.body);
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test'))
    throw new Error('审核审计检查仅允许隔离库');
  const database = createDatabase(source);
  try {
    const audit = await database.pool.query<{ count: string }>(
      "SELECT count(*) FROM comment_moderation_records WHERE comment_id=ANY($1::uuid[]) AND action='approve'",
      [[first.id, second.id]],
    );
    expect(Number(audit.rows[0]?.count)).toBe(2);
  } finally {
    await database.close();
  }
  expect(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await admin.evaluate(() => scrollTo(0, 0));
  await admin.screenshot({ path: join(directory, 'moderation-queue.png'), fullPage: true });
  await info.attach('comment-moderation-queue', {
    path: join(directory, 'moderation-queue.png'),
    contentType: 'image/png',
  });
});
