import { selectTheme } from '../fixtures/theme.js';
import { loginCreator } from '../fixtures/browser-account.js';
import { logoutAccount } from '../fixtures/account-navigation.js';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { createDatabase } from '@personamarket/database';
import { createAdministrator, createTotp } from '@personamarket/server';
import { mailToken, mailText } from '../fixtures/mailpit.js';
import { z } from 'zod';

// 登录请求、二维码与恢复码不进入 trace 或失败截图。
test.use({ trace: 'off', screenshot: 'off' });

test('账号安全在大字触控布局中，提交按钮文字和重新验证入口保持完整可操作', async ({
  browser,
}, info) => {
  const mobile = info.project.name === 'mobile';
  const origin = process.env['PLAYWRIGHT_ORIGIN'];
  if (!origin) throw new Error('必须使用隔离测试站点');
  const context = await browser.newContext({
    baseURL: origin,
    viewport: mobile
      ? { width: 360, height: 800 }
      : info.project.name === 'tablet'
        ? { width: 768, height: 1024 }
        : { width: 1440, height: 900 },
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: 'reduce',
  });
  try {
    const page = await context.newPage();
    await loginCreator(page);
    await page.goto('/dashboard/security');
    await expect(page).toHaveURL(/\/account\?tab=security$/);
    await expect(page.getByRole('tab', { name: '站点设置', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '修改登录密码', exact: true })).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    for (const label of ['更新登录密码', '发送新邮箱确认邮件', '提交停用申请']) {
      const bounds = await page
        .getByRole('button', { name: label, exact: true })
        .evaluate((element) => {
          const button = element.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(element);
          const text = range.getBoundingClientRect();
          return {
            left: button.left,
            right: button.right,
            top: button.top,
            bottom: button.bottom,
            height: button.height,
            text: { left: text.left, right: text.right, top: text.top, bottom: text.bottom },
          };
        });
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      expect(bounds.text.left).toBeGreaterThanOrEqual(bounds.left - 0.5);
      expect(bounds.text.right).toBeLessThanOrEqual(bounds.right + 0.5);
      expect(bounds.text.top).toBeGreaterThanOrEqual(bounds.top - 0.5);
      expect(bounds.text.bottom).toBeLessThanOrEqual(bounds.bottom + 0.5);
    }
    const reverify = page.getByRole('link', { name: '重新验证二次身份', exact: true });
    await expect(reverify).toHaveAttribute('href', '/account?tab=mfa');
    if (mobile) await reverify.tap();
    else {
      await reverify.focus();
      await page.keyboard.press('Enter');
    }
    await expect(page).toHaveURL(/\/account\?tab=mfa$/);
  } finally {
    await context.close();
  }
});
process.env['PLAYWRIGHT_NO_COPY_PROMPT'] = '1';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const entries: Array<{
      event: string;
      at: number;
      path: string;
      fragmentLength: number;
      targetFragmentLength?: number;
    }> = [];
    const paths = new Set(['/verify-email', '/reset-password', '/change-email']);
    const record = (event: string, input?: string | URL | null) => {
      const target = input == null ? null : new URL(input, window.location.href);
      if (!paths.has(window.location.pathname) && !paths.has(target?.pathname ?? '')) return;
      entries.push({
        event,
        at: Math.round(performance.now()),
        path: window.location.pathname,
        fragmentLength: window.location.hash.length,
        ...(target ? { targetFragmentLength: target.hash.length } : {}),
      });
      // 只保存长度和时序，不记录验证令牌、URL或history state
      document.documentElement.dataset['mailNavigation'] = JSON.stringify(entries.slice(-30));
    };
    for (const method of ['replaceState', 'pushState'] as const) {
      const original = window.history[method].bind(window.history);
      window.history[method] = (data: unknown, unused: string, url?: string | URL | null) => {
        record(method, url);
        original(data, unused, url);
      };
    }
    window.addEventListener('hashchange', () => record('hashchange'));
    window.addEventListener('DOMContentLoaded', () => record('DOMContentLoaded'));
  });
});
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus || page.isClosed()) return;
  const diagnostic = await page.evaluate(() => ({
    path: window.location.pathname,
    fragmentLength: window.location.hash.length,
    readyState: document.readyState,
    history: document.documentElement.dataset['mailNavigation'] ?? '[]',
  }));
  await info.attach('mail-navigation', {
    body: JSON.stringify(diagnostic, null, 2),
    contentType: 'application/json',
  });
});

async function openMailToken(page: Page, path: string, token: string) {
  // 邮件链接是完整导航，令牌在首次渲染前已经存在；不在初始路由提交期间注入片段
  await page.evaluate(({ path, token }) => window.location.assign(path + '#token=' + token), {
    path,
    token,
  });
  await expect
    .poll(() => ({ path: new URL(page.url()).pathname, length: new URL(page.url()).hash.length }))
    .toEqual({ path, length: 50 });
}
test('邮件确认入口在初始加载后读取片段，缺少片段时保持禁用', async ({ page }) => {
  for (const [path, label] of [
    ['/verify-email', '验证邮箱'],
    ['/reset-password', '重置密码'],
    ['/change-email', '确认新邮箱'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('button', { name: label, exact: true })).toBeDisabled();
  }
  for (let index = 0; index < 12; index++) {
    await page.goto('/login');
    await openMailToken(page, '/verify-email', 'a'.repeat(43));
    await expect(page.getByRole('button', { name: '验证邮箱', exact: true })).toBeEnabled();
    // 已可操作的同文档页面仍需响应片段清除和替换
    await page.evaluate(() => {
      window.location.hash = '';
    });
    await expect(page.getByRole('button', { name: '验证邮箱', exact: true })).toBeDisabled();
    await page.evaluate(() => {
      window.location.hash = 'token=' + 'a'.repeat(43);
    });
    await expect(page.getByRole('button', { name: '验证邮箱', exact: true })).toBeEnabled();
  }
});

test('真实邮箱注册、验证、登录与全部会话退出，跨设备布局和键盘表单可用', async ({ page }, info) => {
  const username = 'e2e_' + randomUUID().replaceAll('-', '').slice(0, 12);
  const email = username + '@fixture.invalid';
  const password = 'Browser registration passphrase 2026';
  await test.step('注册、邮箱验证和首次登录', async () => {
    await page.goto('/register');
    // 只记录尚未填写任何凭据的公开表单，认证过程仍禁用 trace 与自动截图。
    await page.screenshot({ path: info.outputPath('register-empty-light.png'), fullPage: true });
    await selectTheme(page, 'dark');
    await expect(page.locator('html')).toHaveClass('dark');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath('register-empty-dark.png'), fullPage: true });
    await selectTheme(page, 'light');
    await page.getByLabel('用户名', { exact: true }).fill(username);
    await page.getByLabel('邮箱', { exact: true }).fill(email);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByLabel('密码', { exact: true }).press('Enter');
    await expect(page.getByText('如果注册信息可用，验证邮件将发送到你的邮箱')).toBeVisible();
    const token = await mailToken(email, 'verify-email');
    await openMailToken(page, '/verify-email', token);
    await expect(page.getByRole('button', { name: '验证邮箱', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '验证邮箱', exact: true }).click();
    await expect(page.getByText('邮箱验证成功，可以登录了')).toBeVisible();
    await expect.poll(() => new URL(page.url()).hash.length).toBe(0);
    await page.getByRole('link', { name: '前往登录', exact: true }).click();
    await page.getByLabel('用户名或邮箱').fill(email);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByText('邮箱已验证', { exact: true })).toBeVisible();
    expect((await page.request.get('/api/v1/admin/settings/brand')).status()).toBe(403);
  });
  const nextPassword = await test.step('重置密码和重新登录', async () => {
    await page.goto('/forgot-password');
    await page.getByLabel('注册邮箱').fill(email);
    await page.getByRole('button', { name: '发送重置邮件', exact: true }).click();
    await expect(page.getByText('如果该邮箱可以接收邮件，我们会发送下一步操作说明')).toBeVisible();
    const reset = await mailToken(email, 'reset-password');
    await page.goto('/reset-password');
    await expect(page.getByRole('button', { name: '重置密码', exact: true })).toBeDisabled();
    await page.goto('/forgot-password');
    await openMailToken(page, '/reset-password', reset);
    const nextPassword = 'Browser changed passphrase 2026';
    await page.getByLabel('新密码', { exact: true }).fill(nextPassword);
    await page.getByRole('button', { name: '重置密码', exact: true }).click();
    await expect(page.getByText('密码已重置，请重新登录')).toBeVisible();
    await expect(page.getByRole('link', { name: '账号与安全', exact: true })).toHaveCount(0);
    expect((await page.request.get('/api/v1/auth/sessions')).status()).toBe(401);
    await page.getByRole('link', { name: '使用新密码登录', exact: true }).click();
    await page.getByLabel('用户名或邮箱').fill(email);
    await page.getByLabel('密码', { exact: true }).fill(nextPassword);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL(/\/account$/);
    return nextPassword;
  });
  await test.step('停用撤回、邮箱变更和密码轮换', async () => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('tab', { name: '密码与邮箱', exact: true }).click();
    await expect(page).toHaveURL(/\/account\?tab=security$/);
    await expect(page.getByRole('heading', { name: '修改登录密码', exact: true })).toBeVisible();
    const reverify = page.getByRole('link', { name: '重新验证二次身份', exact: true });
    await expect(reverify).toHaveAttribute('href', '/account?tab=mfa');
    const target = await reverify.boundingBox();
    expect(target?.width).toBeGreaterThanOrEqual(44);
    expect(target?.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath('security-empty-light.png'), fullPage: true });
    await selectTheme(page, 'dark');
    await page.screenshot({ path: info.outputPath('security-empty-dark.png'), fullPage: true });
    await selectTheme(page, 'light');
    const deactivation = page.getByRole('form', { name: '账号停用申请', exact: true });
    await deactivation.getByLabel('当前密码', { exact: true }).fill(nextPassword);
    await deactivation.getByLabel('申请原因', { exact: true }).fill('暂时休息，保留撤回选择');
    await deactivation.getByLabel('确认申请', { exact: true }).fill('申请停用');
    await deactivation.getByRole('button', { name: '提交停用申请', exact: true }).click();
    await expect(page.getByText('申请待处理', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '撤回停用申请', exact: true }).click();
    await expect(page.getByText('上一份申请已撤回', { exact: true })).toBeVisible();
    const newEmail = 'changed-' + email;
    const emailForm = page.getByRole('form', { name: '变更联系邮箱', exact: true });
    await emailForm.getByLabel('当前密码', { exact: true }).fill(nextPassword);
    await emailForm.getByLabel('新邮箱', { exact: true }).fill(newEmail);
    await emailForm.getByRole('button', { name: '发送新邮箱确认邮件', exact: true }).click();
    await expect(
      page.getByText('如果新邮箱可用，确认邮件将发送到该地址，确认前账号仍使用原邮箱'),
    ).toBeVisible();
    const emailToken = await mailToken(newEmail, 'change-email');
    await openMailToken(page, '/change-email', emailToken);
    await page.getByRole('button', { name: '确认新邮箱', exact: true }).click();
    await expect(page.getByText('新邮箱已确认，请使用新邮箱或用户名重新登录')).toBeVisible();
    expect((await page.request.get('/api/v1/auth/sessions')).status()).toBe(401);
    await page.getByRole('link', { name: '使用新邮箱登录', exact: true }).click();
    await page.getByLabel('用户名或邮箱').fill(newEmail);
    await page.getByLabel('密码', { exact: true }).fill(nextPassword);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL(/\/account$/);
    await page.getByRole('tab', { name: '密码与邮箱', exact: true }).click();
    const passwordForm = page.getByRole('form', { name: '修改登录密码', exact: true });
    await passwordForm.getByLabel('当前密码', { exact: true }).fill(nextPassword);
    const finalPassword = 'Q7!m9W2#x4rT'; // 正好 12 个字符，验证用户要求的新下限。
    await passwordForm.getByLabel('新密码', { exact: true }).fill(finalPassword);
    await passwordForm.getByRole('button', { name: '更新登录密码', exact: true }).click();
    await expect(page).toHaveURL(/\/login\?notice=password-changed$/);
    expect((await page.request.get('/api/v1/auth/sessions')).status()).toBe(401);
    await page.getByLabel('用户名或邮箱').fill(newEmail);
    await page.getByLabel('密码', { exact: true }).fill(finalPassword);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole('button', { name: '退出全部设备', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '退出全部设备', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('link', { name: '账号与安全', exact: true })).toHaveCount(0);
  });
});

test('管理员浏览器 MFA 引导、一次性恢复码与品牌设置', async ({ page, request }, info) => {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test'))
    throw new Error('MFA E2E 要求隔离测试库');
  const username = 'admin_' + randomUUID().replaceAll('-', '').slice(0, 12);
  const password = 'Browser admin setup passphrase 2026';
  const database = createDatabase(source);
  try {
    await createAdministrator(database, {
      username,
      email: username + '@fixture.invalid',
      password,
    });
  } finally {
    await database.close();
  }
  expect((await request.get('/api/v1/admin/settings/brand')).status()).toBe(401);
  await page.goto('/login');
  await page.getByLabel('用户名或邮箱').fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  expect((await page.request.get('/api/v1/admin/settings/brand')).status()).toBe(200);
  await page.getByRole('tab', { name: '二次验证', exact: true }).click();
  const setupEvent = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/auth/mfa/setup') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '开始绑定身份验证器' }).click();
  const setup = z
    .object({ data: z.object({ secret: z.string() }) })
    .parse(await (await setupEvent).json());
  await expect(page.getByAltText('使用身份验证器扫描此二维码')).toBeVisible();
  const code = createTotp(setup.data.secret, username).generate();
  await page.getByLabel('六位动态验证码').fill(code);
  await page.getByRole('button', { name: '确认绑定', exact: true }).click();
  await expect(page.getByRole('heading', { name: '安全保存一次性恢复码' })).toBeVisible();
  await expect(page.getByRole('list', { name: '一次性恢复码' }).getByRole('listitem')).toHaveCount(
    10,
  );
  await page.getByRole('button', { name: '已安全保存，继续' }).click();
  await expect(page).toHaveURL(/\/account\?tab=mfa$/);
  await expect(page.getByRole('list', { name: '一次性恢复码' })).toHaveCount(0);
  await page.getByRole('tab', { name: '站点设置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '站点展示' })).toBeVisible();
  await expect(page.getByLabel('站点名称')).toBeVisible();
  await page.getByLabel('站点简介').fill('人设灵感，从这里开始');
  await page.getByRole('tab', { name: '设备会话', exact: true }).click();
  await expect(page.getByRole('heading', { name: '设备会话', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel('站点简介')).toHaveValue('人设灵感，从这里开始');
  await page.getByRole('button', { name: '保存品牌设置', exact: true }).click();
  await expect(page.getByText('品牌设置已保存，首页将展示最新内容')).toBeVisible();
  await page.getByRole('link', { name: '更多站点管理设置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '站点品牌设置', exact: true })).toBeVisible();
  const settingsMenu = page.getByRole('button', { name: '选择设置分组', exact: true });
  if (await settingsMenu.isVisible()) await settingsMenu.click();
  await page.getByRole('link', { name: '邮件服务 SMTP', exact: true }).click();
  await expect(page.getByRole('heading', { name: '邮件服务设置', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('mail-settings-environment.png'), fullPage: true });
  await page.getByRole('button', { name: '自定义 SMTP', exact: true }).click();
  await page.getByLabel('SMTP 端口', { exact: true }).fill('1');
  await page.getByRole('button', { name: '保存邮件设置', exact: true }).click();
  await expect(page.getByText('上次修改已保存，API 和 Worker 将使用当前邮件配置')).toBeVisible();
  await page.getByRole('button', { name: '发送测试邮件', exact: true }).click();
  await expect(page.getByText('测试发送失败，请检查主机、端口、TLS 和凭据后重试')).toBeVisible();
  await page.getByLabel('SMTP 端口', { exact: true }).fill('11025');
  await page.getByRole('button', { name: '保存邮件设置', exact: true }).click();
  await expect(page.getByRole('button', { name: '发送测试邮件', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '发送测试邮件', exact: true }).click();
  await expect(page.getByText('测试邮件已由 SMTP 服务器接收，请检查管理员邮箱')).toBeVisible();
  expect(await mailText(username + '@fixture.invalid', 'SMTP 配置可正常投递')).toContain(
    '这是一封',
  );
  await page.getByRole('button', { name: '恢复部署默认值', exact: true }).click();
  await page.getByRole('button', { name: '应用到表单', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await page.getByRole('button', { name: '保存邮件设置', exact: true }).click();
  await expect(page.getByRole('button', { name: '自定义 SMTP', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByText('有未保存的设置，保存后即时生效', { exact: true })).toHaveCount(0);
  if (await settingsMenu.isVisible()) await settingsMenu.click();
  await page.getByRole('link', { name: '注册与会话', exact: true }).click();
  await page.getByRole('switch', { name: '开放新用户注册', exact: true }).click();
  await page.getByRole('button', { name: '保存注册设置', exact: true }).click();
  await expect(
    page.getByText('注册设置已保存，新注册和之后创建的完整会话使用当前策略', { exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        z
          .object({ data: z.object({ registrationAvailable: z.boolean() }) })
          .parse(await (await page.request.get('/api/v1/auth/context')).json()).data
          .registrationAvailable,
    )
    .toBe(false);
  await page.getByRole('button', { name: '恢复部署默认值', exact: true }).click();
  await page.getByRole('button', { name: '应用到表单', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await page.getByRole('button', { name: '保存注册设置', exact: true }).click();
  await expect(
    page.getByText('注册设置已保存，新注册和之后创建的完整会话使用当前策略', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('switch', { name: '开放新用户注册', exact: true })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await logoutAccount(page);
  await expect(page.getByRole('link', { name: '登录', exact: true })).toBeVisible();
});
