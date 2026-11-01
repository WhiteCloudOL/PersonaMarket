import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { commentPaginationFixture } from '../fixtures/comment-pagination.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });
let fixture: Awaited<ReturnType<typeof commentPaginationFixture>>;
test.beforeAll(async ({ browser }, info) => {
  fixture = await commentPaginationFixture(browser, info, false);
});
test.afterAll(async () => {
  await fixture?.close();
});

test('公开评论与本人记录真实翻页，排序重置页码，URL恢复与翻页保留输入', async ({ page }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  const first = fixture.rows[0];
  const last = fixture.rows[20];
  const previous = fixture.rows[15];
  if (!first || !last || !previous) throw new Error('缺少分页基准');
  await page.goto('/personas/' + fixture.personaId + '#comments');
  const publicPages = page.getByRole('navigation', { name: '公开评论分页', exact: true });
  await expect(page.locator('[aria-label="评论楼层"]')).toHaveCount(20);
  await expect(page.locator('#comment-' + first.id)).toContainText(first.latest.body);
  await expect(publicPages).toContainText('第 1 / 2 页');
  const size = page.viewportSize();
  if (!size) throw new Error('缺少分页验收视口');
  const directory = join('data/tests/comments/pagination', `${size.width}x${size.height}`);
  await mkdir(directory, { recursive: true });
  await publicPages.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(directory, 'roots-page-1.png') });
  await publicPages.getByRole('link', { name: '下一页', exact: true }).click();
  await expect(page).toHaveURL(/commentsPage=2/);
  await expect(page.locator('[aria-label="评论楼层"]')).toHaveCount(1);
  await expect(page.locator('#comment-' + last.id)).toContainText(last.latest.body);
  await page.reload();
  await expect(publicPages).toContainText('第 2 / 2 页');
  await expect(page.locator('#comment-' + last.id)).toBeVisible();
  await page.getByRole('combobox', { name: '评论排序', exact: true }).click();
  await page.getByRole('option', { name: '最新评论优先', exact: true }).click();
  await expect(page).toHaveURL(/commentsSort=newest/);
  expect(new URL(page.url()).searchParams.has('commentsPage')).toBe(false);
  await expect(publicPages).toContainText('第 1 / 2 页');
  await expect(page.locator('[aria-label="评论楼层"]').first()).toHaveAttribute(
    'id',
    'comment-' + last.id,
  );
  const owner = fixture.owner;
  await owner.goto('/personas/' + fixture.personaId + '#my-comments');
  const input = owner.locator('#comment-composer').getByLabel('评论内容', { exact: true });
  await input.fill('翻页时保留尚未提交的使用体验');
  const ownPages = owner.getByRole('navigation', { name: '我的评论分页', exact: true });
  await expect(owner.locator('#my-comments article')).toHaveCount(5);
  await expect(owner.locator('#my-comments article').first()).toContainText(last.latest.body);
  const confirmations: string[] = [];
  owner.on('dialog', async (dialog) => {
    confirmations.push(dialog.message());
    await dialog.dismiss();
  });
  await ownPages.getByRole('link', { name: '下一页', exact: true }).click();
  await expect(owner).toHaveURL(/myCommentsPage=2/);
  await expect(ownPages).toContainText('第 2 / 5 页');
  await expect(owner.locator('#my-comments article').first()).toContainText(previous.latest.body);
  await expect(input).toHaveValue('翻页时保留尚未提交的使用体验');
  await ownPages.getByRole('link', { name: '上一页', exact: true }).click();
  await expect(ownPages).toContainText('第 1 / 5 页');
  await expect(owner.locator('#my-comments article').first()).toContainText(last.latest.body);
  await expect(input).toHaveValue('翻页时保留尚未提交的使用体验');
  await owner
    .getByRole('navigation', { name: '公开评论分页', exact: true })
    .getByRole('link', { name: '下一页', exact: true })
    .click();
  await expect(owner).toHaveURL(/commentsPage=2/);
  await expect(input).toHaveValue('翻页时保留尚未提交的使用体验');
  expect(confirmations).toEqual([]);
  const beforeLeaving = owner.url();
  await owner.getByRole('link', { name: '清蒸云鸭·人设市场', exact: true }).click();
  expect(confirmations).toEqual(['评论还有未提交的内容，确定离开吗']);
  await expect(owner).toHaveURL(beforeLeaving);
  await expect(input).toHaveValue('翻页时保留尚未提交的使用体验');
});
