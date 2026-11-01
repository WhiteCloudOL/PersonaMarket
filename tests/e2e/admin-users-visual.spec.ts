import { selectTheme } from '../fixtures/theme.js';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { createDatabase } from '@personamarket/database';
import { createAdministrator } from '@personamarket/server';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });

test('用户管理浅深色、长理由、键盘焦点和手机大字号保持可用', async ({ page }, info) => {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test')) throw new Error('必须使用隔离测试库');
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  const database = createDatabase(source);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 18);
  const username = 'visual_admin_' + suffix;
  const targetName = 'visual_target_' + suffix;
  const password = 'Visual management browser fixture 2026';
  const evidence = join('data/tests/admin-users-visual', info.project.name, randomUUID());
  const metrics: unknown[] = [];
  try {
    for (const name of [username, targetName])
      await createAdministrator(database, {
        username: name,
        email: name + '@fixture.invalid',
        password,
      });
    await page.goto('/login');
    await page.getByLabel('用户名或邮箱').fill(username);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL(/\/account$/);
    await page.goto('/admin/users?q=' + targetName);
    await expect(
      page.getByRole('button', { name: '管理 ' + targetName, exact: true }),
    ).toBeVisible();
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: join(evidence, 'list-light.png'), fullPage: true });
    await selectTheme(page, 'dark');
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.screenshot({ path: join(evidence, 'list-dark.png'), fullPage: true });
    await page.getByRole('button', { name: '管理 ' + targetName, exact: true }).click();
    const panel = page.getByRole('dialog', { name: '用户详情', exact: true });
    await expect(panel.getByText(targetName + '@fixture.invalid', { exact: true })).toBeVisible();
    await page.screenshot({ path: join(evidence, 'detail-dark.png') });
    await panel.getByRole('button', { name: '撤销会话', exact: true }).click();
    const reason = panel.getByLabel('处理理由', { exact: true });
    const body = '核对账号与创作内容，保留完整处理依据和换行\n'.repeat(80);
    await reason.fill(body);
    const size = await reason.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      viewport: innerHeight,
    }));
    expect(size.height).toBeLessThanOrEqual(size.viewport * 0.45 + 1);
    expect(size.scrollHeight).toBeGreaterThan(size.clientHeight);
    metrics.push({ stage: 'normal-font', ...size });
    await reason.focus();
    await page.keyboard.press('Tab');
    const confirmation = panel.getByRole('checkbox', {
      name: '我已核对账号、操作与影响范围',
      exact: true,
    });
    await expect(confirmation).toBeFocused();
    await page.keyboard.press('Space');
    await expect(confirmation).toBeChecked();
    await page.keyboard.press('Tab');
    const execute = panel.getByRole('button', { name: '确认执行', exact: true });
    await expect(execute).toBeFocused();
    await expect(execute).toBeInViewport();
    await page.screenshot({ path: join(evidence, 'keyboard-dark.png') });
    await page.setViewportSize({ width: 390, height: 460 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await reason.focus();
    await expect(reason).toHaveValue(body);
    const large = await reason.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      viewport: innerHeight,
    }));
    expect(large.height).toBeLessThanOrEqual(large.viewport * 0.45 + 1);
    expect(large.scrollHeight).toBeGreaterThan(large.clientHeight);
    await page.keyboard.press('Tab');
    await expect(confirmation).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(execute).toBeFocused();
    await expect(execute).toBeInViewport();
    const bounds = await execute.boundingBox();
    if (!bounds) throw new Error('确认操作按钮没有可见布局');
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(460);
    const pageBounds = await page.evaluate(() => ({
      width: innerWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
    }));
    expect(pageBounds.pageScrollWidth).toBeLessThanOrEqual(pageBounds.width);
    const panelBounds = await panel.evaluate((element) => ({
      width: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(panelBounds.scrollWidth).toBeLessThanOrEqual(panelBounds.width);
    metrics.push({
      stage: '390x460-font-200',
      ...large,
      ...pageBounds,
      panel: panelBounds,
      button: bounds,
    });
    await page.screenshot({ path: join(evidence, 'short-mobile-200-dark.png') });
    await expect(reason).toHaveValue(body);
    await writeFile(
      join(evidence, 'metrics.json'),
      JSON.stringify({ project: info.project.name, metrics }, null, 2),
    );
  } finally {
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
    await database.close();
  }
});
