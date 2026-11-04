import { randomUUID } from 'node:crypto';
import { test as base, expect, type Browser, type Page } from '@playwright/test';
import { createDatabase } from '@personamarket/database';
import { createAdministrator } from '@personamarket/server';
import {
  AccountSettingsResponseSchema,
  AuthContextResponseSchema,
  AuthNoticeResponseSchema,
  DraftResponseSchema,
  PersonaDraftSchema,
  ErrorResponseSchema,
  accountSettingsEtag,
  type AccountSettings,
} from '@personamarket/contracts';
import { browserWrite } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { logoutAccount, selectAccountNavigation } from '../fixtures/account-navigation.js';
import { mailToken } from '../fixtures/mailpit.js';

const endpoint = '/api/v1/admin/settings/accounts';
const savedText = '注册设置已保存，新注册和之后创建的完整会话使用当前策略';
const origin = () => process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100';
function databaseUrl() {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !/^\/pm_e2e_[a-f0-9]{32}_test$/.test(new URL(source).pathname))
    throw new Error('账户设置E2E仅允许本轮受控隔离库');
  return source;
}
async function current(page: Page) {
  return AccountSettingsResponseSchema.parse(await (await page.request.get(endpoint)).json());
}
async function update(page: Page, data: AccountSettings, reason = '隔离浏览器更新注册策略') {
  const before = await current(page);
  const response = await browserWrite(page, endpoint, { data, reason }, 'PATCH', {
    'If-Match': accountSettingsEtag(before.meta.revision),
    'Idempotency-Key': randomUUID(),
  });
  expect(response.status()).toBe(200);
  return AccountSettingsResponseSchema.parse(await response.json());
}
const test = base.extend<{ administrator: { username: string; password: string } }>({
  administrator: [
    async ({ page }, use) => {
      const username = 'accounts_admin_' + randomUUID().replaceAll('-', '').slice(0, 10),
        password = 'Account policy browser passphrase 2026';
      const database = createDatabase(databaseUrl());
      try {
        await createAdministrator(database, {
          username,
          email: username + '@fixture.invalid',
          password,
        });
      } finally {
        await database.close();
      }
      expect(
        (
          await browserWrite(page, '/api/v1/auth/login', { identifier: username, password })
        ).status(),
      ).toBe(200);
      const state = await current(page);
      await update(
        page,
        {
          ...state.defaults,
          registrationEnabled: true,
          verificationEmailTiming: 'on_registration',
          registrationRateLimit: { maxAttempts: 10, windowSeconds: 3600 },
        },
        '初始化本用例真实账户策略',
      );
      await use({ username, password });
    },
    { auto: true },
  ],
});
test.use({ trace: 'off', screenshot: 'off' });
test.beforeEach(async ({ page }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
});
async function advanced(page: Page) {
  await expect(page.getByRole('button', { name: /^(展开|收起)频率与会话设置$/u })).toBeVisible();
  const open = page.getByRole('button', { name: '展开频率与会话设置', exact: true });
  if (await open.isVisible()) await open.click();
  await expect(page.getByLabel('新会话有效期（秒）', { exact: true })).toBeVisible();
}
async function confirmSave(page: Page) {
  await page.getByRole('button', { name: '保存注册设置', exact: true }).click();
}
async function settingsNavigation(page: Page, name: string) {
  const selector = page.getByRole('button', { name: '选择设置分组', exact: true });
  if (await selector.isVisible()) await selector.click();
  const link = page.getByRole('link', { name, exact: true }),
    href = await link.getAttribute('href');
  if (!href) throw new Error('设置分组缺少真实目标');
  page.once('dialog', (dialog) => dialog.accept());
  await link.click();
  await expect(page).toHaveURL(new URL(href, origin()).href);
  await expect(page.getByRole('dialog', { name: '网站设置', exact: true })).toBeHidden();
}
async function authorContext(browser: Browser, page: Page) {
  return browser.newContext({
    baseURL: origin(),
    viewport: page.viewportSize(),
    reducedMotion: 'reduce',
    hasTouch: test.info().project.name === 'mobile',
    isMobile: test.info().project.name === 'mobile',
  });
}
async function login(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('用户名或邮箱', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
}
async function expire(username: string, method: 'mfa' | 'password') {
  const database = createDatabase(databaseUrl());
  try {
    await database.pool.query(
      method === 'mfa'
        ? "UPDATE auth_sessions SET mfa_verified_at=now()-interval '11 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)"
        : "UPDATE auth_sessions SET created_at=now()-interval '11 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
      [username],
    );
  } finally {
    await database.close();
  }
}

test('注册策略默认差异和字段定位完整，并发的独立字段一次保存', async ({ page }) => {
  const initial = await current(page);
  await page.goto('/admin/settings/accounts');
  await expect(page.getByLabel('新会话有效期（秒）', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: '登录后主动申请', exact: true }).click();
  await advanced(page);
  const ttl = initial.defaults.sessionTtlSeconds === 600 ? '1200' : '600';
  await page.getByLabel('新会话有效期（秒）', { exact: true }).fill(ttl);
  await page.getByRole('button', { name: '恢复部署默认值', exact: true }).click();
  const defaults = page.getByRole('alertdialog', { name: '恢复注册默认值', exact: true });
  await expect(defaults.getByRole('region', { name: '注册默认值差异', exact: true })).toContainText(
    '验证邮件发送时机',
  );
  await defaults.getByRole('button', { name: '保留当前输入', exact: true }).click();
  await expect(page.getByLabel('新会话有效期（秒）', { exact: true })).toHaveValue(ttl);
  await page.getByRole('button', { name: '恢复部署默认值', exact: true }).click();
  await defaults.getByRole('button', { name: '应用到表单', exact: true }).click();
  await expect(page.getByLabel('新会话有效期（秒）', { exact: true })).toHaveValue(
    String(initial.defaults.sessionTtlSeconds),
  );
  await page.getByRole('button', { name: '恢复部署默认值', exact: true }).click();
  await expect(defaults).toContainText('当前输入已是部署默认值，没有需要替换的设置');
  await defaults.getByRole('button', { name: '保留当前输入', exact: true }).click();
  await page.getByLabel('注册业务窗口（秒）', { exact: true }).fill('59');
  await page.getByRole('button', { name: '收起频率与会话设置', exact: true }).click();
  await page.getByRole('button', { name: '保存注册设置', exact: true }).click();
  await expect(page.getByLabel('注册业务窗口（秒）', { exact: true })).toBeFocused();
  await expect(page.locator('#registration-window-error')).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.getByLabel('注册业务窗口（秒）', { exact: true }).fill('3500');
  await confirmSave(page);
  await expect(page.getByText(savedText, { exact: true })).toBeVisible();
  const previous = await current(page);
  await page.getByLabel('新会话有效期（秒）', { exact: true }).fill(ttl);
  await update(page, { ...previous.data, verificationEmailTiming: 'on_request' });
  await confirmSave(page);
  await expect(page.getByText(savedText, { exact: true })).toBeVisible();
  expect((await current(page)).data.sessionTtlSeconds).toBe(Number(ttl));
  await page.getByRole('button', { name: '查看注册策略修改记录', exact: true }).click();
  await page.getByRole('button', { name: '查看注册修改差异', exact: true }).first().click();
  await expect(page.getByRole('region', { name: '注册策略修改记录', exact: true })).toContainText(
    '登录后主动申请',
  );
});

test('结果未知跨页保留原key和后续输入，429后仍能重试；退出后的迟到回执不恢复私有表单', async ({
  page,
  administrator,
}) => {
  await page.goto('/admin/settings/accounts');
  await advanced(page);
  await page.getByLabel('新会话有效期（秒）', { exact: true }).fill('1800');
  let originalKey: string | undefined, replayKey: string | undefined;
  const pattern = '**/api/v1/admin/settings/accounts';
  await page.route(pattern, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    originalKey = route.request().headers()['idempotency-key'];
    const result = await route.fetch();
    expect(result.status()).toBe(200);
    await route.abort('failed');
  });
  await confirmSave(page);
  await expect(
    page.getByText('暂时无法确认保存结果，请再次点击保存。', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('新会话有效期（秒）', { exact: true }).fill('2400');
  await settingsNavigation(page, '站点品牌');
  await settingsNavigation(page, '注册与会话');
  await advanced(page);
  await expect(page.getByLabel('新会话有效期（秒）', { exact: true })).toHaveValue('2400');
  const before = await current(page);
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
  await page.getByRole('button', { name: '保存注册设置', exact: true }).click();
  await expect(page.getByText('隔离浏览器暂时限制核对', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存注册设置', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '保存注册设置', exact: true }).click();
  await expect(
    page.getByText('先前的保存已确认，新的修改已保留。再次点击保存即可提交。', { exact: true }),
  ).toBeVisible();
  expect(originalKey).toBeTruthy();
  expect(replayKey).toBe(originalKey);
  expect((await current(page)).meta).toEqual(before.meta);
  await expect(page.getByLabel('新会话有效期（秒）', { exact: true })).toHaveValue('2400');
  await confirmSave(page);
  await expect(page.getByText(savedText, { exact: true })).toBeVisible();
  expect((await current(page)).data.sessionTtlSeconds).toBe(2400);
  await page.unroute(pattern);
  await page.evaluate(() => {
    Object.defineProperty(window, '__accountSettingsHeap', {
      value: 'same-document-account-settings',
      configurable: true,
    });
  });
  await page.getByLabel('新会话有效期（秒）', { exact: true }).fill('3000');
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
    await page.getByRole('button', { name: '保存注册设置', exact: true }).click();
    await ready;
    await control.goto('/account');
    await logoutAccount(control);
    await expect(page.getByRole('button', { name: '保存注册设置', exact: true })).toHaveCount(0);
    const response = page.waitForResponse(
      (result) => result.url().endsWith(endpoint) && result.request().method() === 'PATCH',
    );
    release();
    expect((await response).status()).toBe(200);
    await expect(page.getByRole('button', { name: '保存注册设置', exact: true })).toHaveCount(0);
    await login(control, administrator.username, administrator.password);
    await expect(page.getByRole('button', { name: '打开账号菜单', exact: true })).toBeVisible();
    await test.step('重新登录后等待品牌页面，再打开注册与会话设置', async () => {
      await selectAccountNavigation(page, '站点设置');
      await expect(page.getByRole('heading', { name: '站点品牌设置', exact: true })).toBeVisible();
      await settingsNavigation(page, '注册与会话');
      await advanced(page);
    });
    expect(await page.evaluate(() => Reflect.get(window, '__accountSettingsHeap'))).toBe(
      'same-document-account-settings',
    );
    await expect(page.getByLabel('新会话有效期（秒）', { exact: true })).toHaveValue('3000');
    await expect(page.getByText('退出前的私有未完成理由', { exact: true })).toHaveCount(0);
  } finally {
    release();
    if (!control.isClosed()) await control.close();
    if (!page.isClosed()) await page.unroute(pattern);
  }
});

test('高危策略分别使用未绑定密码和实际MFA原地确认，验证后保留输入且必须明确重试', async ({
  page,
  administrator,
  browser,
}) => {
  await expire(administrator.username, 'password');
  await page.goto('/admin/settings/accounts');
  const before = await current(page);
  await advanced(page);
  await expect(page.getByRole('button', { name: '验证高危操作', exact: true })).toHaveCount(0);
  await page.getByLabel('新会话有效期（秒）', { exact: true }).fill('3600');
  await confirmSave(page);
  await page.getByRole('button', { name: '验证高危操作', exact: true }).click();
  const passwordSheet = page.getByRole('dialog', { name: '验证高危操作', exact: true });
  await passwordSheet.getByLabel('当前登录密码', { exact: true }).fill(administrator.password);
  await passwordSheet.getByRole('button', { name: '确认身份', exact: true }).click();
  await expect(passwordSheet).toBeHidden();
  await expect(page.getByLabel('新会话有效期（秒）', { exact: true })).toHaveValue('3600');
  expect((await current(page)).meta).toEqual(before.meta);
  await confirmSave(page);
  await expect(page.getByText(savedText, { exact: true })).toBeVisible();
  expect((await current(page)).data.sessionTtlSeconds).toBe(3600);
  const context = await authorContext(browser, page);
  try {
    const bound = await context.newPage(),
      admin = await loginBrowserAdmin(bound);
    await expire(admin.username, 'mfa');
    await bound.goto('/admin/settings/accounts');
    const previous = await current(bound);
    await bound.getByRole('button', { name: '登录后主动申请', exact: true }).click();
    await confirmSave(bound);
    await bound.getByRole('button', { name: '验证高危操作', exact: true }).click();
    const mfaSheet = bound.getByRole('dialog', { name: '验证高危操作', exact: true });
    await expect(mfaSheet.getByLabel('当前登录密码', { exact: true })).toHaveCount(0);
    await mfaSheet.getByLabel('动态验证码或恢复码', { exact: true }).fill(admin.recoveryCode);
    await mfaSheet.getByRole('button', { name: '确认身份', exact: true }).click();
    await expect(mfaSheet).toBeHidden();
    expect((await current(bound)).meta).toEqual(previous.meta);
    await confirmSave(bound);
    await expect(bound.getByText(savedText, { exact: true })).toBeVisible();
    expect((await current(bound)).data.verificationEmailTiming).toBe('on_request');
  } finally {
    await context.close();
  }
});

async function fillRegistration(page: Page, username: string, email: string, password: string) {
  await page.getByLabel('用户名', { exact: true }).fill(username);
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(password);
}
async function register(page: Page) {
  const response = page.waitForResponse(
    (result) =>
      result.url().endsWith('/api/v1/auth/register') && result.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '创建账号', exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(200);
  const notice = AuthNoticeResponseSchema.parse(await result.json());
  await expect(page.getByText(notice.data.message, { exact: true })).toBeVisible();
  await expect(
    page.getByText('请打开邮箱中的验证链接，再回到这里登录', { exact: true }),
  ).toHaveCount(0);
  return notice.data.message;
}

test('按需注册的冲突和429保留输入，未验证真实登录私有编辑，主动申请邮件验证后重新登录', async ({
  page,
  browser,
}) => {
  const initial = await current(page);
  await update(page, { ...initial.data, verificationEmailTiming: 'on_request' });
  const context = await authorContext(browser, page);
  try {
    const author = await context.newPage(),
      username = 'requested_' + randomUUID().replaceAll('-', '').slice(0, 10),
      email = username + '@fixture.invalid',
      password = 'Requested verification creator passphrase 2026';
    await author.goto('/register');
    await expect(author.locator('[data-registration-mode="on_request"]')).toBeVisible();
    await fillRegistration(author, username, email, password);
    let attempts = 0;
    const pattern = '**/api/v1/auth/register';
    await author.route(pattern, async (route) => {
      const status = attempts++ === 0 ? 412 : 429;
      if (attempts > 2) return route.continue();
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: status === 412 ? 'REVISION_CONFLICT' : 'RATE_LIMITED',
            message: status === 412 ? '隔离浏览器注册策略已经更新' : '隔离浏览器注册暂时受限',
            fieldErrors: [],
            requestId: randomUUID(),
          },
        }),
      });
    });
    await author.getByRole('button', { name: '创建账号', exact: true }).click();
    await expect(author.getByText('隔离浏览器注册策略已经更新', { exact: true })).toBeVisible();
    await expect(author.getByLabel('用户名', { exact: true })).toHaveValue(username);
    await expect(author.getByLabel('邮箱', { exact: true })).toHaveValue(email);
    expect(
      await author
        .getByLabel('密码', { exact: true })
        .evaluate((element: HTMLInputElement) => element.value.length),
    ).toBe(password.length);
    await author.getByRole('button', { name: '核对当前注册策略', exact: true }).click();
    await author.getByRole('button', { name: '创建账号', exact: true }).click();
    await expect(author.getByText('隔离浏览器注册暂时受限', { exact: true })).toBeVisible();
    await expect(author.getByLabel('邮箱', { exact: true })).toHaveValue(email);
    expect(
      await author
        .getByLabel('密码', { exact: true })
        .evaluate((element: HTMLInputElement) => element.value.length),
    ).toBe(password.length);
    const message = await register(author);
    expect(message).toContain('主动申请');
    await author.unroute(pattern);
    await login(author, username, password);
    await expect(author.getByText('邮箱待验证', { exact: true })).toBeVisible();
    const auth = AuthContextResponseSchema.parse(
      await (await author.request.get('/api/v1/auth/context')).json(),
    );
    expect(auth.data.account?.role).toBe('user');
    expect(auth.data.account?.emailVerified).toBe(false);
    const created = await browserWrite(author, '/api/v1/me/personas', {
      platform: 'maibot',
      title: '未验证私有草稿 ' + randomUUID().slice(0, 8),
    });
    expect(created.status()).toBe(200);
    const persona = DraftResponseSchema.parse(await created.json());
    const draft = PersonaDraftSchema.parse({
      ...persona.data.draft,
      summary: '未验证账号仍可私有编辑',
      rightsAccepted: true,
      content: { personality: '记录自然与旅程', replyStyle: '轻松亲切', behaviorStyle: '认真倾听' },
    });
    expect(
      (
        await browserWrite(
          author,
          '/api/v1/me/personas/' + persona.data.id + '/draft',
          draft,
          'PUT',
          { 'If-Match': '"draft-1"' },
        )
      ).status(),
    ).toBe(200);
    const rejected = await browserWrite(
      author,
      '/api/v1/me/personas/' + persona.data.id + '/releases',
      {
        version: '1.0.0',
        changelog: '未验证送审仍受原门禁',
        expectedDraftRevision: 2,
        confirmed: true,
      },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(rejected.status()).toBe(403);
    expect(ErrorResponseSchema.parse(await rejected.json()).error.code).toBe('FORBIDDEN');
    await author.getByRole('button', { name: '申请验证邮件', exact: true }).click();
    const token = await mailToken(email, 'verify-email');
    await author.goto('/verify-email');
    const verify = author.getByRole('button', { name: '验证邮箱', exact: true });
    await expect(verify).toBeDisabled();
    await author.evaluate((value) => {
      window.location.hash = 'token=' + value;
    }, token);
    await expect(verify).toBeEnabled();
    await verify.click();
    await expect(author.getByRole('link', { name: '前往登录', exact: true })).toBeVisible();
    expect(
      AuthContextResponseSchema.parse(
        await (await author.request.get('/api/v1/auth/context')).json(),
      ).data.account,
    ).toBeNull();
    await login(author, username, password);
    await expect(author.getByText('邮箱已验证', { exact: true })).toBeVisible();
    expect(
      (await author.request.get('/api/v1/me/personas/' + persona.data.id + '/draft')).status(),
    ).toBe(200);
  } finally {
    await context.close();
  }
});

test('默认自动发信有真实Mailpit邮件，关注册后已有未验证账号仍可登录、申请和找回', async ({
  page,
  browser,
}) => {
  const context = await authorContext(browser, page),
    visitor = await authorContext(browser, page);
  try {
    const author = await context.newPage(),
      username = 'automatic_' + randomUUID().replaceAll('-', '').slice(0, 10),
      email = username + '@fixture.invalid',
      password = 'Automatic verification creator passphrase 2026';
    await author.goto('/register');
    await expect(author.locator('[data-registration-mode="on_registration"]')).toBeVisible();
    await fillRegistration(author, username, email, password);
    expect(await register(author)).toContain('验证邮件将发送');
    const first = await mailToken(email, 'verify-email');
    const state = await current(page);
    await update(page, { ...state.data, registrationEnabled: false });
    const closed = await visitor.newPage();
    await closed.goto('/register');
    await expect(closed.getByText('注册暂未开放，请稍后再来', { exact: true })).toBeVisible();
    await expect(closed.getByRole('link', { name: '登录已有账号', exact: true })).toBeVisible();
    await expect(closed.getByRole('button', { name: '创建账号', exact: true })).toHaveCount(0);
    await login(author, username, password);
    await expect(author.getByText('邮箱待验证', { exact: true })).toBeVisible();
    await author.getByRole('button', { name: '申请验证邮件', exact: true }).click();
    await mailToken(email, 'verify-email', undefined, first);
    await author.goto('/forgot-password');
    await author.getByLabel('注册邮箱', { exact: true }).fill(email);
    await author.getByRole('button', { name: '发送重置邮件', exact: true }).click();
    await mailToken(email, 'reset-password');
  } finally {
    await context.close();
    await visitor.close();
  }
});

test('真实访客注册与普通账号冷启动和刷新保持SSR水合一致，账号导航可正常交互', async ({
  page,
  browser,
}) => {
  const context = await authorContext(browser, page);
  const scriptErrors: Array<{ path: string; kind: 'HYDRATION' | 'SCRIPT_ERROR' }> = [];
  context.on('page', (opened) =>
    opened.on('pageerror', (error) => {
      let path = 'unavailable';
      try {
        path = new URL(opened.url()).pathname;
      } catch {
        /* 页面尚未完成首次导航 */
      }
      scriptErrors.push({
        path,
        kind: /hydration|hydrated|#418/iu.test(error.message) ? 'HYDRATION' : 'SCRIPT_ERROR',
      });
    }),
  );
  try {
    const author = await context.newPage();
    await test.step('真实访客冷载和多次刷新注册页', async () => {
      await author.goto('/register');
      for (let pass = 0; pass < 4; pass++) {
        if (pass) await author.reload();
        await expect(author.getByLabel('用户名', { exact: true })).toBeVisible();
        await expect(author.getByLabel('邮箱', { exact: true })).toBeVisible();
        await expect(author.getByRole('button', { name: '创建账号', exact: true })).toBeEnabled();
        await expect(
          author
            .getByRole('navigation', { name: '账号导航', exact: true })
            .getByRole('link', { name: '登录', exact: true }),
        ).toBeVisible();
        expect(scriptErrors).toEqual([]);
      }
    });
    const username = 'hydrate_' + randomUUID().replaceAll('-', '').slice(0, 12),
      email = username + '@fixture.invalid',
      password = 'Hydration regression creator passphrase 2026';
    await fillRegistration(author, username, email, password);
    await register(author);
    await login(author, username, password);
    await test.step('普通未验证账号冷载刷新与首个账号导航交互', async () => {
      for (let pass = 0; pass < 4; pass++) {
        if (pass) await author.reload();
        await expect(author.getByRole('heading', { name: '账号管理', exact: true })).toBeVisible();
        await expect(author.getByText('邮箱待验证', { exact: true })).toBeVisible();
        await expect(
          author.getByRole('button', { name: '申请验证邮件', exact: true }),
        ).toBeEnabled();
        const trigger = author.getByRole('button', { name: '打开账号菜单', exact: true });
        await trigger.click();
        await expect(
          author
            .getByRole('dialog', { name: '账号导航', exact: true })
            .or(author.getByRole('menu').first()),
        ).toBeVisible();
        await author.keyboard.press('Escape');
        await expect(trigger).toBeFocused();
        expect(scriptErrors).toEqual([]);
      }
    });
    expect(
      AuthContextResponseSchema.parse(
        await (await author.request.get('/api/v1/auth/context')).json(),
      ).data.account?.role,
    ).toBe('user');
    expect(scriptErrors).toEqual([]);
  } finally {
    await context.close();
  }
});
