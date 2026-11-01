import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  AdminUserResponseSchema,
  AuthContextResponseSchema,
  ErrorResponseSchema,
  ProfileSubmissionResponseSchema,
} from '@personamarket/contracts';
import { browserWrite, loginCreator } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';

test.use({ trace: 'off', screenshot: 'off' });
const nonce = () => ({ 'Idempotency-Key': randomUUID() });
async function prepare(page: Page, displayName: string) {
  expect(
    (
      await browserWrite(
        page,
        '/api/v1/me/profile',
        { content: { displayName, bio: '', avatarAssetId: null, links: [] }, expectedRevision: 0 },
        'PUT',
      )
    ).status(),
  ).toBe(200);
  const submitted = await browserWrite(
    page,
    '/api/v1/me/profile/submissions',
    { expectedDraftRevision: 1, confirmed: true },
    'POST',
    nonce(),
  );
  expect(submitted.status()).toBe(200);
  return ProfileSubmissionResponseSchema.parse(await submitted.json()).data;
}

test('普通用户不能审核，审核员可审他人但本人资料只读且不能隐藏公开资料', async ({
  page,
  browser,
}, info) => {
  const options = {
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    viewport: page.viewportSize(),
  };
  const moderatorContext = await browser.newContext(options),
    adminContext = await browser.newContext(options);
  const moderator = await moderatorContext.newPage(),
    admin = await adminContext.newPage();
  const directory = join('data/tests/profiles/roles', info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  try {
    await loginCreator(page);
    const other = await prepare(page, '交由审核员核对的资料');
    await page.goto('/admin/profiles?submission=' + other.id);
    await expect(
      page.getByRole('heading', { name: '你没有资料审核权限', exact: true }),
    ).toBeVisible();
    expect((await page.request.get('/api/v1/admin/profiles/submissions')).status()).toBe(403);

    const credentials = await loginCreator(moderator);
    const context = AuthContextResponseSchema.parse(
      await (await moderator.request.get('/api/v1/auth/context')).json(),
    ).data;
    if (!context.account) throw Error('缺少受控审核员账号');
    const accountId = context.account.id;
    await loginBrowserAdmin(admin);
    const user = AdminUserResponseSchema.parse(
      await (await admin.request.get('/api/v1/admin/users/' + accountId)).json(),
    ).data;
    expect(
      (
        await browserWrite(
          admin,
          '/api/v1/admin/users/' + accountId + '/role',
          {
            role: 'moderator',
            expectedSecurityVersion: user.securityVersion,
            reason: '真实浏览器角色权限验收',
          },
          'PUT',
          nonce(),
        )
      ).status(),
    ).toBe(200);
    await moderator.goto('/login');
    await moderator.getByLabel('用户名或邮箱', { exact: true }).fill(credentials.username);
    await moderator.getByLabel('密码', { exact: true }).fill(credentials.password);
    await moderator.getByRole('button', { name: '登录', exact: true }).click();
    await expect(moderator).toHaveURL(/\/account$/);
    const own = await prepare(moderator, '审核员本人的待审资料');
    const denied = await browserWrite(
      moderator,
      '/api/v1/admin/profiles/submissions/' + own.id + '/review',
      {
        decision: 'approve',
        expectedRevision: 1,
        reason: '审核员尝试自审应被服务端拒绝',
        selfReviewConfirmed: true,
      },
      'POST',
      nonce(),
    );
    expect(denied.status()).toBe(403);
    expect(ErrorResponseSchema.parse(await denied.json()).error.code).toBe('FORBIDDEN');
    await moderator.goto('/admin/profiles?submission=' + own.id);
    const panel = moderator.getByRole('dialog', { name: '审核公开资料', exact: true });
    await expect(panel).toBeVisible();
    await moderator.screenshot({
      path: join(directory, 'moderator-self-state.png'),
      fullPage: true,
    });
    await expect(
      panel.getByText('本人的资料请交由其他审核员或管理员处理', { exact: true }),
    ).toBeVisible();
    await expect(panel.getByRole('button', { name: '核对审核操作', exact: true })).toHaveCount(0);
    await expect(panel.getByRole('checkbox', { name: /同意自审/ })).toHaveCount(0);
    await expect(panel.getByLabel('给作者的处理说明', { exact: true })).toHaveCount(0);
    await panel.getByRole('tab', { name: '处理记录', exact: true }).click();
    await expect(panel.getByRole('heading', { name: '提交审核', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: '关闭资料审核', exact: true }).click();

    await moderator.goto('/admin/profiles?submission=' + other.id);
    await expect(panel).toBeVisible();
    const reason = '已核对他人公开资料，允许发布';
    await panel.getByLabel('给作者的处理说明', { exact: true }).fill(reason);
    await panel.getByRole('tab', { name: '处理记录', exact: true }).click();
    await panel.getByRole('tab', { name: '核对与处理', exact: true }).click();
    await expect(panel.getByLabel('给作者的处理说明', { exact: true })).toHaveValue(reason);
    await panel.getByRole('button', { name: '核对审核操作', exact: true }).click();
    const completed = moderator.waitForResponse(
      (reply) =>
        reply.request().method() === 'POST' &&
        new URL(reply.url()).pathname.endsWith('/' + other.id + '/review'),
    );
    await moderator
      .getByRole('alertdialog')
      .getByRole('button', { name: '确认执行资料处理', exact: true })
      .click();
    expect((await completed).status()).toBe(200);
    await expect(panel.getByText('处理结果已保存', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: '隐藏公开资料', exact: true })).toHaveCount(0);
    expect(
      (
        await browserWrite(
          moderator,
          '/api/v1/admin/profiles/' + other.userId + '/visibility',
          {
            hidden: true,
            expectedRevision: 2,
            reason: '审核员不得执行仅管理员的资料下架',
            selfReviewConfirmed: false,
          },
          'POST',
          nonce(),
        )
      ).status(),
    ).toBe(403);
  } finally {
    await moderatorContext.close();
    await adminContext.close();
  }
});
