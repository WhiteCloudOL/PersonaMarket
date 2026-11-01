import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { AuthContextResponseSchema } from '@personamarket/contracts';
import { loginCreator } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { visualPersonas } from '../fixtures/visual-personas.js';

test.use({ trace: 'off', screenshot: 'off' });
let authorContext: BrowserContext;
let adminContext: BrowserContext;
let author: Page;
let admin: Page;
let username: string;
let ownerId: string;
let touch: boolean;
let works: Awaited<ReturnType<typeof visualPersonas>>;

test.beforeAll(async ({ browser }, info) => {
  touch = info.project.name === 'mobile';
  const options = {
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    viewport: touch
      ? { width: 390, height: 844 }
      : info.project.name === 'tablet'
        ? { width: 768, height: 1024 }
        : { width: 1440, height: 900 },
    hasTouch: touch,
    isMobile: touch,
    reducedMotion: 'reduce' as const,
  };
  authorContext = await browser.newContext(options);
  adminContext = await browser.newContext(options);
  author = await authorContext.newPage();
  admin = await adminContext.newPage();
  username = (await loginCreator(author)).username;
  await loginBrowserAdmin(admin);
  const account = AuthContextResponseSchema.parse(
    await (await author.request.get('/api/v1/auth/context')).json(),
  ).data.account;
  if (!account) throw new Error('缺少真实作者');
  ownerId = account.id;
  works = await visualPersonas(author, admin);
});

test.afterAll(async () => {
  await authorContext?.close();
  await adminContext?.close();
});

async function expand() {
  const trigger = admin.getByRole('button', { name: '更多筛选', exact: true });
  expect((await trigger.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  if (touch) await trigger.tap();
  else {
    await trigger.focus();
    await admin.keyboard.press('Enter');
  }
}
async function choose(label: string, option: string) {
  await admin.getByLabel(label, { exact: true }).click();
  await admin.getByRole('option', { name: option, exact: true }).click();
}

test('人设筛选按需展开，折叠和跨断点保留输入，隐藏错误可定位并真实应用URL', async () => {
  await admin.goto('/admin/personas');
  const query = admin.getByRole('searchbox', { name: '搜索人设', exact: true });
  await expect(query).toBeVisible();
  const owner = admin.getByLabel('作者 ID', { exact: true });
  await expect(owner).toBeHidden();
  await query.fill(works.maibot.title);
  const initialUrl = admin.url();
  await expand();
  await owner.fill('未完成的作者ID');
  await choose('平台', 'MaiBot');
  await admin.getByRole('button', { name: '收起筛选', exact: true }).click();
  await expect(owner).toBeHidden();
  expect(admin.url()).toBe(initialUrl);
  await expand();
  await expect(owner).toHaveValue('未完成的作者ID');
  const original = admin.viewportSize();
  if (!original) throw new Error('缺少视口');
  await admin.setViewportSize(
    original.width >= 1024 ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  );
  await expect(query).toHaveValue(works.maibot.title);
  await expect(admin.getByLabel('平台', { exact: true })).toContainText('MaiBot');
  expect(await admin.locator('#personas-filter-platform').count()).toBe(1);
  await expect(owner).toHaveValue('未完成的作者ID');
  await admin.setViewportSize(original);
  await admin.getByRole('button', { name: '收起筛选', exact: true }).click();
  await admin.getByRole('button', { name: '筛选人设', exact: true }).click();
  await expect(owner).toBeVisible();
  await expect(owner).toBeFocused();
  await expect(owner).toHaveAttribute('aria-invalid', 'true');
  expect(admin.url()).toBe(initialUrl);
  await owner.fill(ownerId);
  await admin.getByRole('button', { name: '筛选人设', exact: true }).click();
  await expect.poll(() => new URL(admin.url()).searchParams.get('ownerId')).toBe(ownerId);
  expect(new URL(admin.url()).searchParams.get('platform')).toBe('maibot');
  expect(new URL(admin.url()).searchParams.get('q')).toBe(works.maibot.title);
  await expect(admin.getByText('共 1 条人设', { exact: true })).toBeVisible();
  await expect(
    admin.locator('#main').getByText(works.maibot.title, { exact: true }).first(),
  ).toBeVisible();
  await expand();
  await admin.getByLabel('分类 ID', { exact: true }).fill(ownerId);
  await admin.getByRole('button', { name: '筛选人设', exact: true }).click();
  await expect.poll(() => new URL(admin.url()).searchParams.get('categoryId')).toBe(ownerId);
  await expect(admin.getByText('共 0 条人设', { exact: true })).toBeVisible();
  await expand();
  await admin.getByRole('button', { name: '清空筛选', exact: true }).click();
  await expect.poll(() => new URL(admin.url()).searchParams.get('ownerId')).toBe(null);
  expect(new URL(admin.url()).searchParams.get('categoryId')).toBe(null);
  await expect(admin.getByText('共 2 条人设', { exact: true })).toBeVisible();
});

test('用户列表将停用申请按需展开，暂存条件可折叠并真实筛选及恢复', async () => {
  await admin.goto('/admin/users');
  await expect(admin.getByLabel('停用申请', { exact: true })).toBeHidden();
  const query = admin.getByRole('searchbox', { name: '搜索用户', exact: true });
  await query.fill(username);
  await expand();
  await choose('角色', '创作者');
  await choose('停用申请', '待处理申请');
  await admin.getByRole('button', { name: '收起筛选', exact: true }).click();
  await expect(query).toHaveValue(username);
  await expand();
  await expect(admin.getByLabel('停用申请', { exact: true })).toContainText('待处理申请');
  await admin.getByRole('button', { name: '筛选用户', exact: true }).click();
  await expect.poll(() => new URL(admin.url()).searchParams.get('deactivation')).toBe('pending');
  await expect(admin.getByText('共 0 位用户', { exact: true })).toBeVisible();
  await expand();
  await admin.getByRole('button', { name: '清空筛选', exact: true }).click();
  await expect
    .poll(() => new URL(admin.url()).searchParams.get('deactivation') ?? 'all')
    .toBe('all');
  await expect(admin.locator('#main').getByText(username, { exact: true }).first()).toBeVisible();
});

test('仅选择作品后展示批量工具，清空后恢复到作品选择控件', async () => {
  await admin.goto('/admin/personas?ownerId=' + ownerId);
  const checkbox = admin.getByRole('checkbox', { name: '选择' + works.maibot.title, exact: true });
  await expect(checkbox).toBeVisible();
  const tools = admin.getByLabel('批量操作工具', { exact: true });
  await expect(tools).toHaveCount(0);
  await checkbox.check();
  await expect(tools).toContainText('已选 1/20 条');
  await tools.getByRole('button', { name: '管理所选人设', exact: true }).click();
  await expect(admin.getByRole('dialog', { name: /批量/ })).toBeVisible();
  await admin.keyboard.press('Escape');
  await expect(admin.getByRole('dialog', { name: /批量/ })).toBeHidden();
  await expect(tools).toHaveCount(0);
  await expect(checkbox).not.toBeChecked();
  await expect(checkbox).toBeFocused();
  await checkbox.check();
  await tools.getByRole('button', { name: '清空选择', exact: true }).click();
  await expect(tools).toHaveCount(0);
  await expect(checkbox).not.toBeChecked();
  await expect(checkbox).toBeFocused();
  await checkbox.check();
  await admin.getByRole('searchbox', { name: '搜索人设', exact: true }).fill(works.astrbot.title);
  await admin.getByRole('button', { name: '筛选人设', exact: true }).click();
  await expect(checkbox).toHaveCount(0);
  await expect(tools).toContainText('已选 1/20 条');
  await tools.getByRole('button', { name: '清空选择', exact: true }).click();
  await expect(tools).toHaveCount(0);
  await expect(admin.getByRole('searchbox', { name: '搜索人设', exact: true })).toBeFocused();
  expect((await author.request.get('/api/v1/admin/personas')).status()).toBe(403);
});

test('品牌未保存状态明确展示，真实保存后清除，再次编辑不显示过期成功提示', async () => {
  await admin.goto('/admin/settings/brand');
  const name = admin.getByLabel('站点名称', { exact: true });
  await expect(name).toBeVisible();
  await name.fill('星光书房的未保存设置');
  const dirty = admin.getByText('有未保存的更改', { exact: true });
  await expect(dirty).toBeVisible();
  await admin.getByRole('button', { name: '保存品牌设置', exact: true }).click();
  const saved = admin.getByText('品牌设置已保存，首页将展示最新内容', { exact: true });
  await expect(saved).toBeVisible();
  await expect(dirty).toHaveCount(0);
  await admin.reload();
  await expect(name).toHaveValue('星光书房的未保存设置');
  await name.fill('星光书房的第二次设置');
  await expect(dirty).toBeVisible();
  await expect(saved).toHaveCount(0);
  await admin.getByRole('button', { name: '保存品牌设置', exact: true }).click();
  await expect(dirty).toHaveCount(0);
});

test('大字管理首屏保留搜索入口，低频权限说明按需阅读', async () => {
  for (const [url, label, description] of [
    ['/admin/personas?ownerId=' + ownerId, '搜索人设', '私有正文在对应的审核页面按权限读取'],
    [
      '/admin/users?q=' + username,
      '搜索用户',
      '按用户名、邮箱或完整账号 ID 搜索，筛选条件保留在地址中',
    ],
  ] as const) {
    await admin.goto(url);
    const search = admin.getByRole('searchbox', { name: label, exact: true });
    await expect(search).toBeVisible();
    await admin.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
      scrollTo(0, 0);
    });
    await expect.soft(search).toBeInViewport({ ratio: 1 });
    const help = admin.getByText(description, { exact: true });
    await expect.soft(help).toBeHidden();
    await expand();
    await expect(help).toBeVisible();
    await help.scrollIntoViewIfNeeded();
    await expect(help).toBeInViewport();
    await admin.evaluate(() => document.documentElement.style.removeProperty('font-size'));
  }
});
