import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { AuthContextResponseSchema } from '@personamarket/contracts';
import { commentPaginationFixture } from '../fixtures/comment-pagination.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });

test('用户审核记录21项真实分页，键盘返回、失败重试和越界页码恢复', async ({ browser }, info) => {
  const fixture = await commentPaginationFixture(browser, info, false);
  const page = fixture.admin;
  try {
    const owner = AuthContextResponseSchema.parse(
      await (await fixture.owner.request.get('/api/v1/auth/context')).json(),
    ).data.account;
    if (!owner) throw new Error('记录作者未登录');
    await page.goto('/admin/users?userId=' + owner.id + '&userView=records&recordKind=comment');
    const panel = page.getByRole('dialog', { name: '用户详情', exact: true });
    const records = panel.getByRole('region', { name: '用户审核与处置记录', exact: true });
    await expect(records.getByText('共 21 条记录', { exact: true })).toBeVisible();
    const links = records.getByRole('link', { name: '查看评论记录', exact: true });
    await expect(links).toHaveCount(20);
    const first = await links.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('href')),
    );
    const pagination = records.getByRole('navigation', { name: '用户审核记录分页', exact: true });
    const next = pagination.getByRole('button', { name: '下一页', exact: true });
    await next.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/recordPage=2/);
    await expect(links).toHaveCount(1);
    await expect(next).toBeDisabled();
    const second = await links.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('href')),
    );
    expect(new Set([...first, ...second]).size).toBe(21);
    expect(new Set([...first, ...second])).toEqual(
      new Set(fixture.rows.map((row) => '/admin/comments?commentId=' + row.id)),
    );
    await page.goBack();
    await expect(links).toHaveCount(20);
    const failing = '**/api/v1/admin/users/*/review-records*';
    await page.route(failing, (route) => route.abort('failed'));
    await records.getByRole('button', { name: '刷新审核记录', exact: true }).click();
    await expect(records.getByRole('button', { name: '重试审核记录', exact: true })).toBeVisible();
    await page.unroute(failing);
    await records.getByRole('button', { name: '重试审核记录', exact: true }).click();
    await expect(records.getByRole('button', { name: '重试审核记录', exact: true })).toBeHidden();
    const invalid = new URL(page.url());
    invalid.searchParams.set('recordPage', '501');
    await page.goto(invalid.href);
    await records.getByRole('button', { name: '重置记录筛选', exact: true }).click();
    await expect(page).not.toHaveURL(/recordPage=501/);
    await expect(
      records
        .getByRole('combobox', { name: '审核记录类别', exact: true })
        .locator('[data-slot="select-value"]'),
    ).toHaveText('全部记录');
    const evidence = join(
      'data/tests/admin-user-context-pagination',
      info.project.name,
      randomUUID(),
    );
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: join(evidence, 'first-page-restored.png') });
  } finally {
    await fixture.close();
  }
});
