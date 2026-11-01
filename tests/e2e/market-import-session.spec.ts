import { expect, test } from '@playwright/test';
import { loginCreator } from '../fixtures/browser-account.js';
import { marketPersona } from '../fixtures/market-personas.js';
test.use({ trace: 'off', screenshot: 'off' });

test('导入确认时会话失效可在新窗口重登，保留来源输入并由用户重试', async ({ page }) => {
  const account = await loginCreator(page);
  await page.goto('/dashboard/personas/import');
  await page.getByLabel('通用人设文件', { exact: true }).setInputFiles({
    name: '保留输入.persona.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(marketPersona())),
  });
  await page.getByRole('button', { name: '预览导入内容', exact: true }).click();
  await page.getByRole('button', { name: '确认内容，下一步', exact: true }).click();
  await page.getByLabel('来源说明', { exact: true }).fill('保留这段已核实的来源');
  await page.getByLabel('本次转载依据', { exact: true }).fill('作者同意署名转载，保留原始许可');
  await page
    .getByRole('checkbox', {
      name: '我已核对正文、图片和来源，确认按上述范围导入私有草稿',
      exact: true,
    })
    .check();
  await page.context().clearCookies();
  await page.getByRole('button', { name: '确认导入草稿', exact: true }).click();
  await expect(page.getByLabel('来源说明', { exact: true })).toHaveValue('保留这段已核实的来源');
  const login = page.getByRole('link', { name: '在新窗口登录', exact: true });
  await expect(login).toBeVisible();
  const opened = page.context().waitForEvent('page');
  await login.click();
  const session = await opened;
  try {
    await expect(session).toHaveURL(/\/login$/);
    await session.getByLabel('用户名或邮箱').fill(account.username);
    await session.getByLabel('密码', { exact: true }).fill(account.password);
    await session.getByRole('button', { name: '登录', exact: true }).click();
    await expect(session).toHaveURL(/\/account$/);
    await expect(login).toHaveCount(0);
    await expect(page.getByLabel('来源说明', { exact: true })).toHaveValue('保留这段已核实的来源');
    await expect(page.getByLabel('本次转载依据', { exact: true })).toHaveValue(
      '作者同意署名转载，保留原始许可',
    );
    await expect(page).toHaveURL(/\/dashboard\/personas\/import$/);
    await page.getByRole('button', { name: '确认导入草稿', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/personas\/[a-f0-9-]+\/edit$/);
  } finally {
    await session.close();
  }
});
