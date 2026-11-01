import { expect, type Page } from '@playwright/test';

const groups: Record<string, string> = {
  管理概览: '审核',
  内容审核: '审核',
  评论审核: '审核',
  资料审核: '审核',
  举报处理: '审核',
  人设管理: '运营',
  分类管理: '运营',
  标签管理: '运营',
  公告管理: '运营',
  指南内容: '运营',
  通知管理: '运营',
  用户管理: '系统',
  失败任务: '系统',
  站点设置: '系统',
};

/** 操作真实菜单/分区，不用直跳路由替代导航交互。 */
export async function accountNavigationItem(page: Page, name: string) {
  await page.getByRole('button', { name: '打开账号菜单', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: '账号导航', exact: true });
  await expect(sheet.or(page.getByRole('menu').first())).toBeVisible();
  const group = groups[name];
  if (await sheet.isVisible()) {
    if (group) await sheet.getByRole('tab', { name: group, exact: true }).click();
    return sheet.getByRole(name === '退出' ? 'button' : 'link', { name, exact: true });
  }
  if (group) await page.getByRole('menuitem', { name: group, exact: true }).click();
  return page.getByRole('menuitem', { name, exact: true });
}

export async function selectAccountNavigation(page: Page, name: string) {
  await (await accountNavigationItem(page, name)).click();
}

export async function logoutAccount(page: Page) {
  const response = page.waitForResponse(
    (result) =>
      result.url().endsWith('/api/v1/auth/logout') && result.request().method() === 'POST',
  );
  await selectAccountNavigation(page, '退出');
  expect((await response).status()).toBe(200);
  await expect(
    page
      .getByRole('navigation', { name: '账号导航', exact: true })
      .getByRole('link', { name: '登录', exact: true }),
  ).toBeVisible();
}

export async function closeAccountNavigation(page: Page) {
  // 桌面子菜单先关闭一层，手机 Sheet 一次关闭，均恢复原触发器焦点。
  const sheet = page.getByRole('dialog', { name: '账号导航', exact: true });
  if (await sheet.isVisible()) {
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  } else {
    for (let layer = 0; layer < 2; layer++) {
      const count = await page.getByRole('menu').count();
      if (!count) break;
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(count - 1);
    }
  }
  await expect(page.getByRole('button', { name: '打开账号菜单', exact: true })).toBeFocused();
}
