import { logoutAccount } from '../fixtures/account-navigation.js';
import { expect, test } from '@playwright/test';
import { loginCreator, browserWrite } from '../fixtures/browser-account.js';
import { MyPersonasResponseSchema } from '@personamarket/contracts';
import { fixturePng } from '../fixtures/image.js';

test.use({ trace: 'off', screenshot: 'off' });

test('新窗口首次登录保留访客创作，换账号清理表单、平台缓存、来源缓存和撤销历史', async ({
  page,
}) => {
  await page.goto('/dashboard/personas/new');
  await page.getByLabel('人设名称', { exact: true }).fill('访客先写下的灵感');
  await page.getByLabel('人格设定', { exact: true }).fill('MaiBot 的本地设定');
  await page.getByRole('button', { name: 'AstrBot', exact: true }).click();
  await page.getByLabel('人格设定', { exact: true }).fill('AstrBot 的本地设定');
  await page.getByRole('button', { name: 'MaiBot', exact: true }).click();
  const login = await page.context().newPage();
  try {
    await loginCreator(login);
    await expect(page.getByRole('button', { name: '上传图片', exact: true })).toBeEnabled();
    await expect(page.getByLabel('人设名称', { exact: true })).toHaveValue('访客先写下的灵感');
    await expect(page.getByLabel('人格设定', { exact: true })).toHaveValue('MaiBot 的本地设定');
    await page.getByRole('button', { name: '转载作品', exact: true }).click();
    await page.getByLabel('原作者', { exact: true }).fill('前一个账号的私有来源');
    await page.getByRole('button', { name: '原创作品', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Markdown 介绍', exact: true })
      .fill('前一个账号的私有介绍');
    await page.getByLabel('作品封面', { exact: true }).setInputFiles({
      name: 'private.png',
      mimeType: 'image/png',
      buffer: fixturePng,
    });
    await expect(page.getByAltText('当前作品封面')).toBeVisible();
    await loginCreator(login);
    await expect(page.getByLabel('人设名称', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('人格设定', { exact: true })).toHaveValue('');
    await page.getByRole('button', { name: 'AstrBot', exact: true }).click();
    await expect(page.getByLabel('人格设定', { exact: true })).toHaveValue('');
    await page.getByRole('button', { name: '转载作品', exact: true }).click();
    await expect(page.getByLabel('原作者', { exact: true })).toHaveValue('');
    const editor = page.getByRole('textbox', { name: 'Markdown 介绍', exact: true });
    await editor.press('ControlOrMeta+z');
    await expect(editor).not.toContainText('前一个账号的私有介绍');
    await expect(page.getByAltText('当前作品封面')).toHaveCount(0);
    await page.getByRole('button', { name: '选择已有图片', exact: true }).click();
    await expect(page.getByText('暂无已上传的作品图片', { exact: true })).toBeVisible();
  } finally {
    await login.close();
  }
});

test('同账号会话失效后重登保留输入，另一窗口主动退出清理创作页面', async ({ page }) => {
  const account = await loginCreator(page);
  await page.goto('/dashboard/personas/new');
  await page.getByLabel('人设名称', { exact: true }).fill('重新登录后继续的灵感');
  const login = await page.context().newPage();
  try {
    expect((await browserWrite(login, '/api/v1/auth/logout')).status()).toBe(200);
    await login.goto('/login');
    await page.bringToFront();
    // headless 切换标签不保证产生系统窗口 focus，显式发送激活事件，身份仍由真实API读取
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(
      page
        .getByRole('navigation', { name: '账号导航' })
        .getByRole('link', { name: '登录', exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('人设名称', { exact: true })).toHaveValue('重新登录后继续的灵感');
    await login.getByLabel('用户名或邮箱').fill(account.username);
    await login.getByLabel('密码', { exact: true }).fill(account.password);
    await login.getByRole('button', { name: '登录', exact: true }).click();
    await expect(login).toHaveURL(/\/account$/);
    await expect(page.getByRole('button', { name: '上传图片', exact: true })).toBeEnabled();
    await expect(page.getByLabel('人设名称', { exact: true })).toHaveValue('重新登录后继续的灵感');
    await logoutAccount(login);
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/dashboard/personas/new');
    await expect(page.getByLabel('人设名称', { exact: true })).toHaveValue('');
  } finally {
    await login.close();
  }
});

test('账号切换后旧创建响应不会导航或写入新账号的工作台', async ({ page }) => {
  await loginCreator(page);
  await page.goto('/dashboard/personas/new');
  await page.getByLabel('人设名称', { exact: true }).fill('旧账号已经接受的私有草稿');
  let releaseResponse: () => void = () => {
    throw new Error('响应屏障未初始化');
  };
  const held = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let responseAccepted: (status: number) => void = () => {
    throw new Error('请求屏障未初始化');
  };
  const accepted = new Promise<number>((resolve) => {
    responseAccepted = resolve;
  });
  await page.route('**/api/v1/me/personas', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    responseAccepted(response.status());
    await held;
    await route.fulfill({ response });
  });
  const login = await page.context().newPage();
  try {
    await page.getByRole('button', { name: '创建私有草稿', exact: true }).click();
    expect(await accepted).toBe(200);
    await loginCreator(login);
    await expect(page.getByLabel('人设名称', { exact: true })).toHaveValue('');
    const finished = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/me/personas',
    );
    releaseResponse();
    await finished;
    // 等到已接受响应的回调与可能的路由请求结清，再断言没有旧账号导航
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/dashboard\/personas\/new$/);
    const current = MyPersonasResponseSchema.parse(
      await (await page.request.get('/api/v1/me/personas')).json(),
    );
    expect(current.meta.total).toBe(0);
  } finally {
    releaseResponse();
    await login.close();
  }
});

test('切换账号清理其他页面中的二次验证绑定状态', async ({ page }) => {
  await loginCreator(page);
  await page.goto('/mfa?setup=1');
  await page.getByRole('button', { name: '开始绑定身份验证器', exact: true }).click();
  const secret = page.locator('[data-sensitive="mfa-secret"]');
  await expect(secret).toHaveCount(1);
  // 仅遮蔽测试凭据，保留元素和组件状态，使失败证据也不包含真实可用密钥
  await secret.evaluate((element) => {
    element.textContent = '[已遮蔽测试密钥]';
  });
  const login = await page.context().newPage();
  try {
    await loginCreator(login);
    await expect(secret).toHaveCount(0);
    await expect(
      page.getByRole('img', { name: '使用身份验证器扫描此二维码', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: '开始绑定身份验证器', exact: true }),
    ).toBeVisible();
  } finally {
    await login.close();
  }
});
