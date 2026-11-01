import { expect, test } from '@playwright/test';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
test.use({ trace: 'off', screenshot: 'off' });
test('人设筛选实际提交字段，不把分页元数据混入严格表单校验', async ({ page }) => {
  await loginBrowserAdmin(page);
  await page.goto('/admin/personas');
  await expect(
    page.getByRole('heading', { level: 1, name: '人设管理', exact: true }),
  ).toBeVisible();
  await page.getByRole('searchbox', { name: '搜索人设', exact: true }).fill('实际筛选文本');
  const more = page.getByRole('button', { name: '更多筛选', exact: true });
  if (await more.isVisible()) await more.click();
  await page.getByLabel('平台', { exact: true }).click();
  await page.getByRole('option', { name: 'AstrBot', exact: true }).click();
  await page.getByRole('button', { name: '筛选人设', exact: true }).click();
  await expect(page).toHaveURL(/q=%E5%AE%9E%E9%99%85%E7%AD%9B%E9%80%89%E6%96%87%E6%9C%AC/);
  expect(new URL(page.url()).searchParams.get('platform')).toBe('astrbot');
  await expect(page.getByText('没有符合条件的人设', { exact: true })).toBeVisible();
});
