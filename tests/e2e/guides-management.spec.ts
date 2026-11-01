import {
  logoutAccount,
  accountNavigationItem,
  closeAccountNavigation,
} from '../fixtures/account-navigation.js';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { AdminGuideResponseSchema, guideEtag } from '@personamarket/contracts';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { browserWrite } from '../fixtures/browser-account.js';

test.use({ trace: 'off', screenshot: 'off' });
const endpoint = '/api/v1/admin/guides/maibot';
async function read(page: Page) {
  return AdminGuideResponseSchema.parse(await (await page.request.get(endpoint)).json()).data;
}
async function edit(page: Page, title: string, reason: string) {
  const before = await read(page);
  const response = await browserWrite(
    page,
    endpoint,
    { title, summary: before.summary, bodyMarkdown: before.bodyMarkdown, reason },
    'PATCH',
    { 'If-Match': guideEtag('maibot', before.revision), 'Idempotency-Key': randomUUID() },
  );
  expect(response.status()).toBe(200);
  return AdminGuideResponseSchema.parse(await response.json()).data;
}
async function ensurePublished(page: Page) {
  const before = await read(page);
  if (before.status === 'published' && !before.hasUnpublishedChanges) return;
  const response = await browserWrite(
    page,
    endpoint + '/actions/publish',
    { confirmed: true, reason: '准备隔离测试的公开指南' },
    'POST',
    { 'If-Match': guideEtag('maibot', before.revision), 'Idempotency-Key': randomUUID() },
  );
  expect(response.status()).toBe(200);
}
test('管理员通过真实表单保存、预览、确认发布和撤回，修订记录可核对且撤回保留本地输入', async ({
  page,
}, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  await loginBrowserAdmin(page);
  await ensurePublished(page);
  const directory = join('data/tests/guides-management', info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  await page.goto('/admin/guides');
  await expect(
    page.getByRole('heading', { level: 1, name: '指南内容', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /^编辑指南：/ })).toHaveCount(9);
  await expect(await accountNavigationItem(page, '指南内容')).toBeVisible();
  await closeAccountNavigation(page);
  await page.goto('/admin/guides?guide=maibot');
  const panel = page.getByRole('dialog', { name: '编辑指南', exact: true });
  await expect(panel).toBeVisible();
  const title = '核对发布的教程 ' + randomUUID().slice(0, 8);
  await page.getByLabel('指南标题', { exact: true }).fill(title);
  await page.getByLabel('简短介绍', { exact: true }).fill('真实编辑稿与公开稿分开维护');
  await page
    .getByLabel('指南正文', { exact: true })
    .fill(
      '# 教程内部标题\n\n保留空白和 `原生示例.toml`\n\n<script>window.badGuide=true</script>\n\n[危险地址](javascript:alert(1))\n\n![外部图片](https://fixture.invalid/private.png)\n',
    );
  if (info.project.name !== 'desktop') {
    await page.getByRole('tab', { name: '查看预览' }).click();
    await expect(page.getByRole('region', { name: '编辑稿正文预览' })).toContainText(
      '原生示例.toml',
    );
    await expect(
      page.getByRole('region', { name: '编辑稿正文预览' }).locator('script'),
    ).toHaveCount(0);
    await page.getByRole('tab', { name: '编辑正文' }).click();
    await expect(page.getByLabel('指南标题', { exact: true })).toHaveValue(title);
  }
  await page.getByLabel('处理理由', { exact: true }).fill('先保存，再由管理员核对发布');
  await page.screenshot({ path: join(directory, 'editing.png') });
  const saving = page.waitForResponse(
    (response) => response.url().endsWith(endpoint) && response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: '保存编辑稿', exact: true }).click();
  expect((await saving).status()).toBe(200);
  await expect(panel.getByText('编辑稿已保存，核对后可确认发布', { exact: true })).toBeVisible();
  expect((await (await page.request.get('/api/v1/site/guides/maibot')).json()).data.title).not.toBe(
    title,
  );
  await page.getByLabel('处理理由', { exact: true }).fill('确认公开这次教程修订');
  await page.getByRole('button', { name: '发布指南', exact: true }).click();
  const confirmation = page.getByRole('alertdialog', { name: '确认发布指南', exact: true });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText(title);
  await page.screenshot({ path: join(directory, 'publish-confirmation.png') });
  await page.keyboard.press('Escape');
  await expect(confirmation).not.toBeVisible();
  await expect
    .poll(() => panel.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  await expect(page.getByLabel('指南标题', { exact: true })).toHaveValue(title);
  await page.getByRole('button', { name: '发布指南', exact: true }).click();
  await confirmation.getByRole('button', { name: '确认发布', exact: true }).click();
  await expect(confirmation).not.toBeVisible();
  await expect(page.getByRole('button', { name: '核对最新指南', exact: true })).toBeFocused();
  await expect
    .poll(() => panel.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  expect((await (await page.request.get('/api/v1/site/guides/maibot')).json()).data.title).toBe(
    title,
  );
  await expect(panel.getByRole('heading', { name: '指南记录', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '查看修订详情', exact: true }).first().click();
  await expect(panel.getByRole('region', { name: '变更后正文', exact: true })).toContainText(
    '原生示例.toml',
  );
  await page.getByLabel('指南标题', { exact: true }).fill('撤回时仍保留的未保存标题');
  await page.getByLabel('处理理由', { exact: true }).fill('先撤回公开版本，保留正在修改的内容');
  await page.getByRole('button', { name: '撤回指南', exact: true }).click();
  const withdrawal = page.getByRole('alertdialog', { name: '撤回公开指南', exact: true });
  await expect(withdrawal).toContainText(title);
  await withdrawal.getByRole('button', { name: '确认撤回', exact: true }).click();
  await expect(withdrawal).not.toBeVisible();
  await expect(page.getByRole('button', { name: '核对最新指南', exact: true })).toBeFocused();
  await expect
    .poll(() => panel.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  await expect(page.getByLabel('指南标题', { exact: true })).toHaveValue(
    '撤回时仍保留的未保存标题',
  );
  expect((await page.request.get('/api/v1/site/guides/maibot')).status()).toBe(404);
  await page.screenshot({ path: join(directory, 'withdrawn-local-input.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await writeFile(
    join(directory, 'verified.json'),
    JSON.stringify(
      {
        workflow: true,
        scriptExecuted: await page.evaluate(() => Object.hasOwn(window, 'badGuide')),
        viewport: page.viewportSize(),
      },
      null,
      2,
    ),
  );
  expect(await page.evaluate(() => Object.hasOwn(window, 'badGuide'))).toBe(false);
});

test('编辑响应丢失后幂等重试保留本地正文，通过最新修订继续提交，关闭和返回仍保留输入', async ({
  page,
}) => {
  await loginBrowserAdmin(page);
  await page.goto('/admin/guides?guide=maibot');
  const panel = page.getByRole('dialog', { name: '编辑指南', exact: true });
  await page.getByLabel('指南标题', { exact: true }).fill('响应丢失时保留的本地标题');
  await page.getByLabel('处理理由', { exact: true }).fill('测试真实写入后丢失响应');
  const keys: string[] = [];
  let lost = false;
  await page.route('**' + endpoint, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    keys.push(route.request().headers()['idempotency-key'] ?? '');
    if (!lost) {
      lost = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await response.dispose();
      return route.abort('failed');
    }
    return route.continue();
  });
  await page.getByRole('button', { name: '保存编辑稿', exact: true }).click();
  await expect(panel.getByRole('alert')).toBeVisible();
  const remote = await edit(page, '另一页面随后保存的标题', '另一页面真实提交');
  await page.getByRole('button', { name: '保存编辑稿', exact: true }).click();
  await expect(
    panel.getByText('服务器已有后续修订，当前输入已保留，请核对最新内容后继续', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('指南标题', { exact: true })).toHaveValue(
    '响应丢失时保留的本地标题',
  );
  await expect(
    panel.getByText(new RegExp('另一页面随后保存的标题.*修订 ' + remote.revision)),
  ).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await page.getByRole('button', { name: '采用最新修订继续核对', exact: true }).click();
  await page.getByRole('button', { name: '保存编辑稿', exact: true }).click();
  await expect(panel.getByText('编辑稿已保存，核对后可确认发布', { exact: true })).toBeVisible();
  const current = await read(page);
  expect(current.title).toBe('响应丢失时保留的本地标题');
  expect(current.revision).toBe(remote.revision + 1);
  expect(keys).toHaveLength(3);
  expect(keys[2]).not.toBe(keys[1]);
  await page.getByLabel('指南标题', { exact: true }).fill('关闭面板后仍能继续的输入');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '关闭编辑面板', exact: true }).click();
  await expect(panel).not.toBeVisible();
  await page.getByRole('button', { name: /^编辑指南：响应丢失时保留的本地标题$/ }).click();
  await expect(page.getByLabel('指南标题', { exact: true })).toHaveValue(
    '关闭面板后仍能继续的输入',
  );
  await page.goBack();
  await expect(panel).not.toBeVisible();
  await page.goForward();
  await expect(page.getByLabel('指南标题', { exact: true })).toHaveValue(
    '关闭面板后仍能继续的输入',
  );
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '关闭编辑面板', exact: true }).click();
  await expect(panel).not.toBeVisible();
  await logoutAccount(page);
  await expect(page).toHaveURL(/\/$/);
  await loginBrowserAdmin(page);
  await page.goto('/admin/guides?guide=maibot');
  await expect(page.getByLabel('指南标题', { exact: true })).toHaveValue(
    '响应丢失时保留的本地标题',
  );
});

test('目录失败可重试，筛选可分享，手机预览中的非法字段能回到编辑并聚焦', async ({ page }, info) => {
  await loginBrowserAdmin(page);
  const route = (url: URL) => url.pathname === '/api/v1/admin/guides';
  await page.route(route, (route) => route.abort('failed'));
  await page.goto('/admin/guides');
  await expect(page.getByRole('button', { name: '重试读取指南', exact: true })).toBeVisible();
  await page.unroute(route);
  await page.getByRole('button', { name: '重试读取指南', exact: true }).click();
  await expect(page.getByRole('button', { name: /^编辑指南：/ })).toHaveCount(9);
  await page.getByLabel('搜索指南标题', { exact: true }).fill('不存在的指南标题');
  await page.getByRole('button', { name: '筛选指南', exact: true }).click();
  await expect(page).toHaveURL(/q=/);
  await expect(page.getByText('没有符合条件的指南', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清空筛选', exact: true }).click();
  await expect(page.getByRole('button', { name: /^编辑指南：/ })).toHaveCount(9);
  await page.goto('/admin/guides?guide=astrbot');
  await page.getByLabel('指南标题', { exact: true }).fill('');
  await page.getByLabel('处理理由', { exact: true }).fill('校验字段聚焦');
  if (info.project.name !== 'desktop')
    await page.getByRole('tab', { name: '查看预览', exact: true }).click();
  await page.getByRole('button', { name: '保存编辑稿', exact: true }).click();
  await expect(page.getByLabel('指南标题', { exact: true })).toBeFocused();
  await expect(page.getByLabel('指南标题', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
});
