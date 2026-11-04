import { mkdir } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { browserWrite } from '../fixtures/browser-account.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 8000 });
test.beforeEach(async ({ page }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
});

async function navigate(page: Page, name: string, route: string) {
  const groups = page.getByRole('button', { name: '选择设置分组' });
  if (await groups.isVisible()) await groups.click();
  await page.getByRole('link', { name, exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/admin/settings/' + route + '$'));
}

async function checkLayout(page: Page, save: Locator, route: string, project: string) {
  await expect(save).toBeVisible();
  expect((await save.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env['SETTINGS_CAPTURE']) {
    const directory = 'data/tests/settings-save';
    await mkdir(directory, { recursive: true });
    await page.screenshot({
      path: directory + '/' + route + '-after-' + project + '.png',
      animations: 'disabled',
      fullPage: true,
    });
  }
}

test('注册设置直接保存，切换分组无提示，刷新后保留', async ({ page }, info) => {
  await loginBrowserAdmin(page);
  await page.goto('/admin/settings/accounts');
  const registration = page.getByRole('switch', { name: '开放新用户注册' });
  await expect(registration).toBeVisible();
  const save = page.getByRole('button', { name: '保存注册设置', exact: true });
  await checkLayout(page, save, 'accounts', info.project.name);
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await registration.click();
  const enabled = await registration.getAttribute('aria-checked');
  await save.click();
  await expect(page.getByText('注册设置已保存', { exact: false })).toBeVisible();
  await navigate(page, '邮件服务 SMTP', 'mail');
  expect(dialogs).toEqual([]);
  await page.goto('/admin/settings/accounts');
  await expect(registration).toHaveAttribute('aria-checked', enabled ?? '');
  await registration.click();
  const groups = page.getByRole('button', { name: '选择设置分组' });
  if (await groups.isVisible()) await groups.click();
  await page.getByRole('link', { name: '注册与会话', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/accounts$/);
  expect(dialogs).toEqual([]);
  if (await groups.isVisible()) await groups.click();
  await page.getByRole('link', { name: '邮件服务 SMTP', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/accounts$/);
  expect(dialogs).toEqual(['有未保存的设置，确定离开吗']);
});

test('其他十一组设置保存后可直接离开，重新加载显示持久化值', async ({ page }, info) => {
  test.setTimeout(120_000);
  await loginBrowserAdmin(page);
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.accept();
  });
  const toggle = (label: string) => async () => {
    const field = page.getByRole('switch', { name: label, exact: true });
    await expect(field).toBeVisible();
    const value = (await field.getAttribute('aria-checked')) === 'true' ? 'false' : 'true';
    await field.click();
    return () => expect(field).toHaveAttribute('aria-checked', value);
  };
  const fill = (label: string, value: string) => async () => {
    const field =
      label === '公共维护提示'
        ? page.locator('#maintenance-message')
        : page.getByLabel(label, { exact: true });
    await field.fill(value);
    return () => expect(field).toHaveValue(value);
  };
  const cases = [
    ['brand', '保存品牌设置', '品牌设置已保存', fill('站点简介', '浏览器核验站点简介')],
    ['home', '保存首页设置', '首页设置已保存', fill('首页短提示', '浏览器核验首页短提示')],
    [
      'model-suggestions',
      '保存模型建议',
      '模型建议已保存',
      async () => {
        await page.getByRole('button', { name: '添加模型建议', exact: true }).click();
        const field = page.getByLabel(/建议 \d+ · 模型标识/).last();
        await field.fill('fixture-model/settings-save');
        return () => expect(field).toHaveValue('fixture-model/settings-save');
      },
    ],
    ['creation', '保存创作设置', '创作设置已保存', toggle('开放人设投稿')],
    ['transfer', '保存导入导出设置', '导入导出设置已保存', toggle('允许未登录访客导出')],
    ['media', '保存文件与图片设置', '文件与图片设置已保存', toggle('允许本地图片上传')],
    ['community', '保存社区设置', '社区设置已保存', toggle('开放新增点赞')],
    ['rankings', '保存排行与运营设置', '排行与运营设置已保存', fill('点赞权重', '42')],
    ['policies', '保存规则草稿', '草稿已保存', fill('规则标题', '浏览器核验规则草稿')],
    ['system', '保存维护设置', '维护设置已保存', fill('公共维护提示', '浏览器核验维护提示')],
    [
      'mail',
      '保存邮件设置',
      '上次修改已保存',
      async () => {
        const mode = page.getByRole('button', { name: '停用邮件', exact: true });
        await mode.click();
        return () => expect(mode).toHaveAttribute('aria-pressed', 'true');
      },
    ],
  ] as const;
  for (const [route, action, saved, edit] of cases) {
    await test.step(route, async () => {
      await page.goto('/admin/settings/' + route);
      const save = page.getByRole('button', { name: action, exact: true });
      await checkLayout(page, save, route, info.project.name);
      const persisted = await edit();
      await expect(
        page.getByText(/草稿修改理由|处理理由|核对最新|已读取修订|当前核对修订/u),
      ).toHaveCount(0);
      await save.click();
      await expect(page.getByText(saved, { exact: false })).toBeVisible();
      await navigate(page, '注册与会话', 'accounts');
      await page.goto('/admin/settings/' + route);
      await persisted();
      expect(dialogs).toEqual([]);
    });
  }
});

test('并发修改独立字段时一次保存两边的输入', async ({ page }) => {
  await loginBrowserAdmin(page);
  await page.goto('/admin/settings/brand');
  const name = page.getByLabel('站点名称', { exact: true });
  const description = page.getByLabel('站点简介', { exact: true });
  await description.fill('当前窗口提交的说明');
  const path = '/api/v1/admin/settings/brand';
  const response = await page.request.get(path);
  const etag = response.headers()['etag'];
  if (!etag) throw new Error('品牌设置缺少 ETag');
  const data = (await response.json()).data;
  expect(
    (
      await browserWrite(page, path, { ...data, name: '并发窗口提交的名称' }, 'PATCH', {
        'If-Match': etag,
      })
    ).status(),
  ).toBe(200);
  await page.getByRole('button', { name: '保存品牌设置', exact: true }).click();
  await expect(page.getByText('品牌设置已保存', { exact: false })).toBeVisible();
  await page.reload();
  await expect(name).toHaveValue('并发窗口提交的名称');
  await expect(description).toHaveValue('当前窗口提交的说明');
});
