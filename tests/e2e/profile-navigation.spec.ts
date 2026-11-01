import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { loginCreator } from '../fixtures/browser-account.js';

test.use({ trace: 'off', screenshot: 'off' });
function homepage(page: Page) {
  return page
    .getByRole('menuitem', { name: '公开主页', exact: true })
    .or(page.getByRole('link', { name: '公开主页', exact: true }));
}
test('账号菜单直达当前账号的真实公开主页，退出换号后不保留原主页入口', async ({
  page,
  browser,
}, info) => {
  const touch = info.project.name === 'mobile';
  const context = await browser.newContext({
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    viewport: info.project.name === 'desktop' ? { width: 1440, height: 900 } : page.viewportSize(),
    hasTouch: touch,
  });
  const owner = await context.newPage();
  const directory = join('data/tests/profiles/navigation', info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  try {
    const first = await loginCreator(owner);
    const trigger = owner.getByRole('button', { name: '打开账号菜单', exact: true });
    await trigger.click();
    await expect(
      owner.getByRole('menu').or(owner.getByRole('dialog', { name: '账号导航', exact: true })),
    ).toBeVisible();
    const link = homepage(owner);
    await expect(link).toHaveAttribute('href', '/users/' + first.username);
    await expect(link).toBeVisible();
    await owner.screenshot({ path: join(directory, 'account-menu.png'), fullPage: false });
    await expect(link).toBeVisible();
    const bounds = await link.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    await owner.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await trigger.click();
    if (touch) await link.tap();
    else await link.click();
    await expect(owner).toHaveURL(new RegExp('/users/' + first.username + '$'));
    await expect(
      owner.getByRole('heading', { level: 1, name: first.username, exact: true }),
    ).toBeVisible();
    await trigger.click();
    const loggedOut = owner.waitForResponse(
      (reply) =>
        new URL(reply.url()).pathname === '/api/v1/auth/logout' &&
        reply.request().method() === 'POST',
    );
    await owner
      .getByRole('menuitem', { name: '退出', exact: true })
      .or(owner.getByRole('button', { name: '退出', exact: true }))
      .click();
    expect((await loggedOut).status()).toBe(200);
    await expect(trigger).not.toBeVisible();
    const second = await loginCreator(owner);
    expect(second.username).not.toBe(first.username);
    await trigger.click();
    await expect(homepage(owner)).toHaveAttribute('href', '/users/' + second.username);
    await expect(owner.locator('a[href="/users/' + first.username + '"]')).toHaveCount(0);
  } finally {
    await context.close();
  }
});
