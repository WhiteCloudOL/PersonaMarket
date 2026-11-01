import { expect, test } from '@playwright/test';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { loginCreator } from '../fixtures/browser-account.js';
import { visualPersonas } from '../fixtures/visual-personas.js';

test.use({ trace: 'off', screenshot: 'off' });
test('浏览器返回并重新打开同一管理面板后保留尚未保存的操作', async ({ page, browser }) => {
  const baseURL = process.env['PLAYWRIGHT_ORIGIN'];
  if (!baseURL) throw new Error('必须使用隔离测试站点');
  const context = await browser.newContext({ baseURL });
  const author = await context.newPage();
  try {
    await loginBrowserAdmin(page);
    await loginCreator(author);
    const works = await visualPersonas(author, page);
    await page.goto('/admin/personas?q=' + works.maibot.id);
    await page.getByRole('button', { name: '管理这条人设', exact: true }).click();
    const panel = page.getByRole('dialog', { name: '管理人设', exact: true });
    await panel.getByLabel('处理理由', { exact: true }).fill('返回时需要保留的管理依据');
    await panel.getByRole('checkbox', { name: '官方作品', exact: true }).check();
    await panel.getByLabel('上下架理由', { exact: true }).fill('另一项尚未确认的操作');
    await page.goBack();
    await expect(panel).not.toBeVisible();
    await page.goForward();
    await expect(panel.getByLabel('处理理由', { exact: true })).toHaveValue(
      '返回时需要保留的管理依据',
    );
    await expect(panel.getByRole('checkbox', { name: '官方作品', exact: true })).toBeChecked();
    await expect(panel.getByLabel('上下架理由', { exact: true })).toHaveValue(
      '另一项尚未确认的操作',
    );
  } finally {
    await context.close();
  }
});
