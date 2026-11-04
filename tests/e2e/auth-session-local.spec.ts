import { logoutAccount } from '../fixtures/account-navigation.js';
import { expect, test } from '@playwright/test';
import { loginCreator } from '../fixtures/browser-account.js';

test.use({ trace: 'off', screenshot: 'off' });

test('本窗口主动退出后，新的访客创作首次登录另一账号仍保留输入', async ({ page }, info) => {
  await loginCreator(page);
  await logoutAccount(page);
  await expect(page).toHaveURL(/\/$/);
  if (info.project.name === 'desktop')
    await page
      .getByRole('navigation', { name: '主导航', exact: true })
      .getByRole('link', { name: '发布', exact: true })
      .click();
  else {
    await page.getByRole('button', { name: '打开导航', exact: true }).click();
    await page
      .getByRole('navigation', { name: '移动端主导航', exact: true })
      .getByRole('link', { name: '发布', exact: true })
      .click();
  }
  await page.getByLabel('人设名称', { exact: true }).fill('退出后重新开始的访客创作');
  const login = await page.context().newPage();
  try {
    await loginCreator(login);
    await expect(page.getByRole('button', { name: '上传图片', exact: true })).toBeEnabled();
    await expect(page.getByLabel('人设名称', { exact: true })).toHaveValue(
      '退出后重新开始的访客创作',
    );
  } finally {
    await login.close();
  }
});
