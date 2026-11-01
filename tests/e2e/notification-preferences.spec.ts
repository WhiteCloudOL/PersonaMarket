import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NotificationPreferencesResponseSchema } from '@personamarket/contracts';
import { loginCreator, browserWrite } from '../fixtures/browser-account.js';

test.use({ trace: 'off', screenshot: 'off' });
test('通知偏好折叠保留选择，冲突后显式采用新修订，保存与换号都保持正确边界', async ({
  page,
}, info) => {
  const viewport =
    info.project.name === 'desktop'
      ? { width: 1440, height: 900 }
      : info.project.name === 'tablet'
        ? { width: 768, height: 1024 }
        : { width: 390, height: 844 };
  await page.setViewportSize(viewport);
  const directory = join('data/tests/notifications/preferences', info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  await loginCreator(page);
  await page.goto('/dashboard/notifications');
  await expect(page.getByText('暂时没有通知', { exact: true })).toBeVisible();
  const toggle = page.getByRole('button', { name: '通知偏好', exact: true });
  await toggle.click();
  const checkbox = page.getByRole('checkbox', { name: '接收作品提交和审核结果邮件', exact: true });
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();
  await toggle.click();
  await toggle.click();
  await expect(checkbox).not.toBeChecked();
  await page.screenshot({ path: join(directory, 'selection-retained.png'), fullPage: true });
  expect(
    (
      await browserWrite(
        page,
        '/api/v1/me/notifications/preferences',
        { reviewEmail: true, expectedRevision: 0 },
        'PATCH',
      )
    ).status(),
  ).toBe(200);
  const save = page.getByRole('button', { name: '保存通知偏好', exact: true });
  await save.click();
  await expect(
    page.getByText('通知偏好已更新，请读取最新设置后核对', { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: join(directory, 'revision-conflict.png'), fullPage: true });
  await expect(checkbox).not.toBeChecked();
  await page.getByRole('button', { name: '读取最新偏好并保留选择', exact: true }).click();
  await expect(
    page.getByText('已读取最新修订，你的选择已保留，请核对后再次保存', { exact: true }),
  ).toBeVisible();
  await save.click();
  await expect(page.getByText('通知偏好已保存', { exact: true })).toBeVisible();
  const current = NotificationPreferencesResponseSchema.parse(
    await (await page.request.get('/api/v1/me/notifications/preferences')).json(),
  );
  expect(current.data).toEqual({ reviewEmail: false, revision: 2 });
  await page.reload();
  await toggle.click();
  await expect(checkbox).not.toBeChecked();
  expect((await browserWrite(page, '/api/v1/auth/logout')).status()).toBe(200);
  await loginCreator(page);
  await page.goto('/dashboard/notifications');
  await toggle.click();
  await expect(checkbox).toBeChecked();
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
    document.documentElement.style.fontSize = '200%';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const label = page.getByText('接收作品提交和审核结果邮件', { exact: true });
  expect((await label.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect(await save.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: join(directory, 'dark-large-preferences.png'), fullPage: true });
  await writeFile(
    join(directory, 'measurements.json'),
    JSON.stringify(
      { viewport, physicalDevice: false, systemKeyboard: false, saved: current.data },
      null,
      2,
    ),
  );
});
