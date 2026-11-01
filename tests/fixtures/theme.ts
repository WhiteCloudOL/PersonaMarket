import { expect, type Page } from '@playwright/test';

/** 通过真实菜单选择主题，截图和业务用例不直接篡改 Cookie 或根样式。 */
export async function selectTheme(page: Page, preference: 'light' | 'dark' | 'system') {
  const labels = { light: '浅色', dark: '深色', system: '跟随系统' };
  const trigger = page.getByRole('button', { name: /^主题偏好/ });
  await trigger.click();
  await page.getByRole('menuitemradio', { name: labels[preference], exact: true }).click();
  await expect(page.getByRole('menu', { name: '主题偏好', exact: true })).toBeHidden();
}
