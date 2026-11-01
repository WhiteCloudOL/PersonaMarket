import { expect, test } from '@playwright/test';
import { commentPaginationFixture } from '../fixtures/comment-pagination.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });
let fixture: Awaited<ReturnType<typeof commentPaginationFixture>>;
test.beforeAll(async ({ browser }, info) => {
  fixture = await commentPaginationFixture(browser, info, true);
});
test.afterAll(async () => {
  await fixture?.close();
});

test('二级回复真实翻页与可分享URL，排序重置展开状态且保留版本引用', async ({ page }) => {
  const root = fixture.root;
  const last = fixture.rows[20];
  if (!root || !last) throw new Error('缺少回复分页基准');
  await page.goto('/personas/' + fixture.personaId + '#comments');
  await page
    .locator('#comment-' + root.id)
    .getByRole('button', { name: '查看 21 条回复', exact: true })
    .click();
  const replies = page.locator('[aria-label="楼层回复"]');
  const pagination = page.getByRole('navigation', { name: '楼层回复分页', exact: true });
  await expect(replies.locator('[aria-label="评论楼层"]')).toHaveCount(20);
  await expect(pagination).toContainText('第 1 / 2 页');
  await pagination.getByRole('link', { name: '下一页', exact: true }).click();
  await expect(page).toHaveURL(/repliesPage=2/);
  expect(new URL(page.url()).searchParams.get('replyThread')).toBe(root.id);
  await expect(replies.locator('[aria-label="评论楼层"]')).toHaveCount(1);
  await expect(replies.locator('#comment-' + last.id)).toContainText(last.latest.body);
  await expect(replies.locator('#comment-' + last.id)).toContainText('针对 v1.0.0');
  await page.reload();
  await expect(pagination).toContainText('第 2 / 2 页');
  await expect(replies.locator('#comment-' + last.id)).toBeVisible();
  await page.getByRole('combobox', { name: '评论排序', exact: true }).click();
  await page.getByRole('option', { name: '最新评论优先', exact: true }).click();
  await expect(page).toHaveURL(/commentsSort=newest/);
  expect(new URL(page.url()).searchParams.has('replyThread')).toBe(false);
  expect(new URL(page.url()).searchParams.has('repliesPage')).toBe(false);
  await expect(replies).toHaveCount(0);
  await page
    .locator('#comment-' + root.id)
    .getByRole('button', { name: '查看 21 条回复', exact: true })
    .click();
  await expect(pagination).toContainText('第 1 / 2 页');
  await expect(replies.locator('[aria-label="评论楼层"]')).toHaveCount(20);
});
