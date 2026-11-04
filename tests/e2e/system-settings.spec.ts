import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { ErrorResponseSchema, SystemSettingsRecordsResponseSchema } from '@personamarket/contracts';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { logoutAccount, selectAccountNavigation } from '../fixtures/account-navigation.js';
import {
  test,
  systemEndpoint,
  systemSavedText,
  currentSystem,
  updateSystem,
  openSystem,
  confirmSystemSave,
  navigateSystemSettings,
  systemBrowserContext,
  loginSystemUser,
  expireSystemCredential,
} from '../fixtures/system-settings.js';

test('维护设置默认差异、字段定位及并发修改保留输入，历史记录一致', async ({ page }) => {
  const initial = await currentSystem(page);
  const beforeRecords = SystemSettingsRecordsResponseSchema.parse(
    await (await page.request.get(systemEndpoint + '/records')).json(),
  );
  await openSystem(page);
  const message = page.getByRole('textbox', { name: '公共维护提示', exact: true });
  await expect(message).toHaveCount(1);
  await expect(message).toHaveAccessibleName('公共维护提示');
  await expect(page.getByRole('heading', { name: 'API运行信息', exact: true })).toHaveCount(0);
  await message.fill('自有隔离维护提示');
  await page.getByRole('button', { name: '恢复部署默认值', exact: true }).click();
  const defaults = page.getByRole('alertdialog', { name: '恢复维护默认值', exact: true });
  await expect(defaults.getByRole('region', { name: '维护默认值差异', exact: true })).toContainText(
    '公共维护提示',
  );
  await defaults.getByRole('button', { name: '保留当前输入', exact: true }).click();
  await expect(message).toHaveValue('自有隔离维护提示');
  await page.getByRole('button', { name: '恢复部署默认值', exact: true }).click();
  await defaults.getByRole('button', { name: '应用到表单', exact: true }).click();
  await expect(message).toHaveValue(initial.defaults.maintenanceMessage);
  await message.fill('文'.repeat(501));
  await page.getByRole('button', { name: '保存维护设置', exact: true }).click();
  await expect(message).toBeFocused();
  await expect(message).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  const content = '隔离验收'.repeat(125);
  await message.fill(content);
  await confirmSystemSave(page);
  await expect(page.getByText(systemSavedText, { exact: true })).toBeVisible();
  expect((await currentSystem(page)).data.maintenanceMessage).toBe(content);
  await expect(page.getByLabel('站点维护提示', { exact: true })).toHaveCount(0);
  const other = await page.context().newPage();
  try {
    await other.goto('/admin/settings/system');
    const state = await currentSystem(other);
    await updateSystem(
      other,
      { ...state.data, maintenanceMessage: '另窗口已提交维护提示' },
      '隔离并发先提交',
    );
  } finally {
    await other.close();
  }
  await message.fill('本地保留的提示');
  const conflictResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(systemEndpoint) && response.request().method() === 'PATCH',
  );
  await confirmSystemSave(page);
  const conflict = await conflictResponse;
  expect(conflict.status()).toBe(412);
  expect(ErrorResponseSchema.parse(await conflict.json()).error.code).toBe('REVISION_CONFLICT');
  await expect(page.getByText(systemSavedText, { exact: true })).toHaveCount(0);
  await expect(message).toHaveValue('本地保留的提示');
  await expect(page.getByText(/其他管理员同时修改了相同设置/u)).toBeVisible();
  await confirmSystemSave(page);
  await expect(page.getByText(systemSavedText, { exact: true })).toBeVisible();
  const records = SystemSettingsRecordsResponseSchema.parse(
    await (await page.request.get(systemEndpoint + '/records')).json(),
  );
  expect(records.meta.total).toBe(beforeRecords.meta.total + 3);
  expect(records.data[0]?.reason).toBe('更新维护设置');
  await page.getByRole('button', { name: '查看维护设置修改记录', exact: true }).click();
  const history = page.getByRole('region', { name: '维护设置修改记录', exact: true });
  await history.getByRole('button', { name: '查看维护修改差异', exact: true }).first().click();
  await expect(history).toContainText('另窗口已提交维护提示');
  await expect(history).toContainText('本地保留的提示');
  const geometry = await page
    .locator('label[for=maintenance-enabled]')
    .evaluate((el) => ({ height: el.getBoundingClientRect().height }));
  expect(geometry.height).toBeGreaterThanOrEqual(44);
  const switchLabel = page.locator('label[for=maintenance-enabled]');
  const box = await switchLabel.boundingBox();
  if (!box) throw new Error('维护开关标签不可见');
  expect(box.width).toBeGreaterThanOrEqual(44);
  const toggle = page.getByRole('switch', { name: '开启维护模式', exact: true });
  const wasChecked = await toggle.isChecked();
  await switchLabel.click({ position: { x: 2, y: box.height / 2 } });
  if (wasChecked) await expect(toggle).not.toBeChecked();
  else await expect(toggle).toBeChecked();
  await switchLabel.click({ position: { x: 2, y: box.height / 2 } });
  if (wasChecked) await expect(toggle).toBeChecked();
  else await expect(toggle).not.toBeChecked();
  await expect(page.getByText('当前表单与已读取配置一致', { exact: true })).toBeVisible();
});

test('高危策略分别使用未绑定密码和实际MFA原地确认，验证后保留输入且必须明确重试', async ({
  page,
  systemAdministrator,
  browser,
}) => {
  await expireSystemCredential(systemAdministrator.username, 'password');
  await page.goto('/admin/settings/system');
  const before = await currentSystem(page);

  await expect(page.getByRole('button', { name: '验证高危操作', exact: true })).toHaveCount(0);
  await page
    .getByRole('textbox', { name: '公共维护提示', exact: true })
    .fill('密码确认后的维护提示');
  await confirmSystemSave(page);
  await page.getByRole('button', { name: '验证高危操作', exact: true }).click();
  const passwordSheet = page.getByRole('dialog', { name: '验证高危操作', exact: true });
  await passwordSheet
    .getByLabel('当前登录密码', { exact: true })
    .fill(systemAdministrator.password);
  await passwordSheet.getByRole('button', { name: '确认身份', exact: true }).click();
  await expect(passwordSheet).toBeHidden();
  await expect(page.getByRole('textbox', { name: '公共维护提示', exact: true })).toHaveValue(
    '密码确认后的维护提示',
  );
  expect((await currentSystem(page)).meta).toEqual(before.meta);
  await confirmSystemSave(page);
  await expect(page.getByText(systemSavedText, { exact: true })).toBeVisible();
  expect((await currentSystem(page)).data.maintenanceMessage).toBe('密码确认后的维护提示');
  const context = await systemBrowserContext(browser, page);
  try {
    const bound = await context.newPage(),
      admin = await loginBrowserAdmin(bound);
    await expireSystemCredential(admin.username, 'mfa');
    await bound.goto('/admin/settings/system');
    const previous = await currentSystem(bound);
    await bound
      .getByRole('textbox', { name: '公共维护提示', exact: true })
      .fill('MFA确认后的维护提示');
    await confirmSystemSave(bound);
    await bound.getByRole('button', { name: '验证高危操作', exact: true }).click();
    const mfaSheet = bound.getByRole('dialog', { name: '验证高危操作', exact: true });
    await expect(mfaSheet.getByLabel('当前登录密码', { exact: true })).toHaveCount(0);
    await mfaSheet.getByLabel('动态验证码或恢复码', { exact: true }).fill(admin.recoveryCode);
    await mfaSheet.getByRole('button', { name: '确认身份', exact: true }).click();
    await expect(mfaSheet).toBeHidden();
    expect((await currentSystem(bound)).meta).toEqual(previous.meta);
    await confirmSystemSave(bound);
    await expect(bound.getByText(systemSavedText, { exact: true })).toBeVisible();
    expect((await currentSystem(bound)).data.maintenanceMessage).toBe('MFA确认后的维护提示');
  } finally {
    await context.close();
  }
});

test('结果未知跨页保留原key和后续输入，429后仍可重试，退出后的迟到回执不恢复私有表单', async ({
  page,
  systemAdministrator,
}) => {
  await page.goto('/admin/settings/system');

  await page.getByRole('textbox', { name: '公共维护提示', exact: true }).fill('原提交维护提示');
  let originalKey: string | undefined, replayKey: string | undefined;
  const pattern = '**/api/v1/admin/settings/system';
  await page.route(pattern, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    originalKey = route.request().headers()['idempotency-key'];
    const result = await route.fetch();
    expect(result.status()).toBe(200);
    await route.abort('failed');
  });
  await confirmSystemSave(page);
  await expect(
    page.getByText('暂时无法确认保存结果，请再次点击保存。', { exact: true }),
  ).toBeVisible();
  await page.getByRole('textbox', { name: '公共维护提示', exact: true }).fill('后续维护提示');
  await navigateSystemSettings(page, '站点品牌');
  await navigateSystemSettings(page, '维护与系统');

  await expect(page.getByRole('textbox', { name: '公共维护提示', exact: true })).toHaveValue(
    '后续维护提示',
  );
  const before = await currentSystem(page);
  await page.unroute(pattern);
  let block = true;
  await page.route(pattern, async (route) => {
    if (route.request().method() === 'PATCH') {
      replayKey = route.request().headers()['idempotency-key'];
      if (block) {
        block = false;
        return route.fulfill({
          status: 429,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'RATE_LIMITED',
              message: '隔离浏览器暂时限制核对',
              fieldErrors: [],
              requestId: randomUUID(),
            },
          }),
        });
      }
    }
    await route.continue();
  });
  await page.getByRole('button', { name: '保存维护设置', exact: true }).click();
  await expect(page.getByText('隔离浏览器暂时限制核对', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存维护设置', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '保存维护设置', exact: true }).click();
  await expect(
    page.getByText('先前的保存已确认，新的修改已保留。再次点击保存即可提交。', { exact: true }),
  ).toBeVisible();
  expect(originalKey).toBeTruthy();
  expect(replayKey).toBe(originalKey);
  expect((await currentSystem(page)).meta).toEqual(before.meta);
  await expect(page.getByRole('textbox', { name: '公共维护提示', exact: true })).toHaveValue(
    '后续维护提示',
  );
  await confirmSystemSave(page);
  await expect(page.getByText(systemSavedText, { exact: true })).toBeVisible();
  expect((await currentSystem(page)).data.maintenanceMessage).toBe('后续维护提示');
  await page.unroute(pattern);
  await page.evaluate(() => {
    Object.defineProperty(window, '__systemSettingsHeap', {
      value: 'same-document-system-settings',
      configurable: true,
    });
  });
  await page.getByRole('textbox', { name: '公共维护提示', exact: true }).fill('等待回执维护提示');
  let release = () => {},
    captured = () => {};
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    ready = new Promise<void>((resolve) => {
      captured = resolve;
    });
  await page.route(pattern, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    const result = await route.fetch();
    expect(result.status()).toBe(200);
    captured();
    await gate;
    await route.fulfill({ response: result });
  });
  const control = await page.context().newPage();
  try {
    await page.getByRole('button', { name: '保存维护设置', exact: true }).click();
    await ready;
    await control.goto('/account');
    await logoutAccount(control);
    await expect(page.getByRole('button', { name: '保存维护设置', exact: true })).toHaveCount(0);
    const response = page.waitForResponse(
      (result) => result.url().endsWith(systemEndpoint) && result.request().method() === 'PATCH',
    );
    release();
    expect((await response).status()).toBe(200);
    await expect(page.getByRole('button', { name: '保存维护设置', exact: true })).toHaveCount(0);
    await loginSystemUser(control, systemAdministrator.username, systemAdministrator.password);
    await expect(page.getByRole('button', { name: '打开账号菜单', exact: true })).toBeVisible();
    await test.step('重新登录后等待品牌页面，再打开维护与系统设置', async () => {
      await selectAccountNavigation(page, '站点设置');
      await expect(page.getByRole('heading', { name: '站点品牌设置', exact: true })).toBeVisible();
      await navigateSystemSettings(page, '维护与系统');
    });
    expect(await page.evaluate(() => Reflect.get(window, '__systemSettingsHeap'))).toBe(
      'same-document-system-settings',
    );
    await expect(page.getByRole('textbox', { name: '公共维护提示', exact: true })).toHaveValue(
      '等待回执维护提示',
    );
    await expect(page.getByText('退出前的私有未完成理由', { exact: true })).toHaveCount(0);
  } finally {
    release();
    if (!control.isClosed()) await control.close();
    if (!page.isClosed()) await page.unroute(pattern);
  }
});
