import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createDatabase } from '@personamarket/database';
import {
  AuthContextResponseSchema,
  OwnProfileResponseSchema,
  ProfileSubmissionResponseSchema,
  ErrorResponseSchema,
  AssetResponseSchema,
  OwnReportResponseSchema,
  type ProfileContent,
} from '@personamarket/contracts';
import { loginCreator, browserWrite } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { fixturePng } from '../fixtures/image.js';

// MFA与账号凭据只存在于测试内存；只手工采集不含验证输入的业务截图
test.use({ trace: 'off', screenshot: 'off' });
const nonce = () => ({ 'Idempotency-Key': randomUUID() });
const profile = (name: string): ProfileContent => ({
  displayName: name,
  bio: '真实资料流程\n<script>window.profileXss=1</script>',
  avatarAssetId: null,
  links: [],
});
function response(page: Page, path: string, method: string) {
  return page.waitForResponse(
    (reply) => new URL(reply.url()).pathname === path && reply.request().method() === method,
  );
}
async function save(page: Page) {
  const saved = response(page, '/api/v1/me/profile', 'PUT');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(
    page.getByText('草稿已保存，审核通过后才会更新公开资料', { exact: true }),
  ).toBeVisible();
}
async function submit(page: Page) {
  await page.getByRole('button', { name: '提交资料审核', exact: true }).click();
  const submitted = response(page, '/api/v1/me/profile/submissions', 'POST');
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '确认提交', exact: true })
    .click();
  const result = await submitted;
  expect(result.status()).toBe(200);
  return ProfileSubmissionResponseSchema.parse(await result.json()).data;
}
async function review(page: Page, id: string, decision: 'approve' | 'reject', reason: string) {
  await page.goto('/admin/profiles?submission=' + id);
  const panel = page.getByRole('dialog', { name: '审核公开资料', exact: true });
  await expect(panel).toBeVisible();
  if (decision === 'reject')
    await panel.getByRole('button', { name: '退回调整', exact: true }).click();
  await panel.getByLabel('给作者的处理说明', { exact: true }).fill(reason);
  await panel.getByRole('button', { name: '核对审核操作', exact: true }).click();
  const done = response(page, '/api/v1/admin/profiles/submissions/' + id + '/review', 'POST');
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '确认执行资料处理', exact: true })
    .click();
  expect((await done).status()).toBe(200);
}

test('资料编辑、头像、审核和旧版公开隔离形成真实浏览器闭环', async ({ page, browser }, info) => {
  const author = await loginCreator(page);
  const adminContext = await browser.newContext({
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    viewport: page.viewportSize(),
  });
  const publicContext = await browser.newContext({
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    viewport: page.viewportSize(),
  });
  const admin = await adminContext.newPage(),
    visitor = await publicContext.newPage();
  const directory = join('data/tests/profiles/flow', info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  try {
    await loginBrowserAdmin(admin);
    await page.goto('/dashboard/profile');
    await page.getByLabel('公开昵称', { exact: true }).fill('清风创作者');
    await page.getByLabel('公开简介', { exact: true }).fill(profile('unused').bio);
    await page.getByRole('button', { name: '添加公开链接', exact: true }).click();
    await page.getByLabel('链接名称 1', { exact: true }).fill('创作手记');
    await page.getByLabel('链接地址 1', { exact: true }).fill('https://example.com/notes');
    const uploaded = response(page, '/api/v1/me/assets/upload/avatar', 'POST');
    await page
      .getByLabel('资料头像', { exact: true })
      .setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: fixturePng });
    expect((await uploaded).status()).toBe(200);
    await expect(page.getByRole('img', { name: '当前草稿头像', exact: true })).toBeVisible();
    await save(page);
    const first = await submit(page);
    await visitor.goto('/users/' + author.username);
    await expect(
      visitor.getByRole('heading', { level: 1, name: author.username, exact: true }),
    ).toBeVisible();
    expect(
      (
        await visitor.request.get('/api/v1/users/' + author.username + '/avatar/' + first.id)
      ).status(),
    ).toBe(404);
    await review(admin, first.id, 'approve', '资料已核验');
    await visitor.reload();
    await expect(
      visitor.getByRole('heading', { level: 1, name: '清风创作者', exact: true }),
    ).toBeVisible();
    await expect(visitor.getByRole('img', { name: '清风创作者的头像', exact: true })).toBeVisible();
    await expect(visitor.getByRole('link', { name: '创作手记', exact: true })).toHaveAttribute(
      'href',
      'https://example.com/notes',
    );
    expect(await visitor.evaluate(() => 'profileXss' in window)).toBe(false);
    await visitor.screenshot({ path: join(directory, 'approved-creator.png'), fullPage: true });
    await page.reload();
    await page.getByLabel('公开昵称', { exact: true }).fill('等待审核的新昵称');
    await page.getByLabel('公开简介', { exact: true }).fill('这段待审简介不能进入公开主页');
    await save(page);
    const second = await submit(page);
    await visitor.reload();
    await expect(
      visitor.getByRole('heading', { level: 1, name: '清风创作者', exact: true }),
    ).toBeVisible();
    expect(await visitor.content()).not.toContain('这段待审简介不能进入公开主页');
    await review(admin, second.id, 'reject', '请调整这份新的公开资料');
    await page.reload();
    await expect(page.getByText('需要调整', { exact: true })).toBeVisible();
    await expect(page.getByLabel('公开昵称', { exact: true })).toHaveValue('等待审核的新昵称');
    const own = OwnProfileResponseSchema.parse(
      await (await page.request.get('/api/v1/me/profile')).json(),
    );
    expect(own.data.published?.id).toBe(first.id);
    expect(own.data.latestSubmission?.status).toBe('REJECTED');
    await page.screenshot({
      path: join(directory, 'rejected-preserved-draft.png'),
      fullPage: true,
    });
  } finally {
    await adminContext.close();
    await publicContext.close();
  }
});

test('资料保存并发与响应丢失不覆盖其他修订，冲突核对保留输入与历史分区', async ({
  page,
  context,
}) => {
  await loginCreator(page);
  expect(
    (
      await browserWrite(
        page,
        '/api/v1/me/profile',
        { content: profile('初始资料'), expectedRevision: 0 },
        'PUT',
      )
    ).status(),
  ).toBe(200);
  const other = await context.newPage();
  try {
    await page.goto('/dashboard/profile');
    await other.goto('/dashboard/profile');
    await expect(page.getByLabel('公开昵称', { exact: true })).toHaveValue('初始资料');
    await expect(other.getByLabel('公开昵称', { exact: true })).toHaveValue('初始资料');
    await page.getByLabel('公开昵称', { exact: true }).fill('已经保存的新修订');
    await save(page);
    await other.getByLabel('公开昵称', { exact: true }).fill('并发窗口保留的输入');
    const conflicted = response(other, '/api/v1/me/profile', 'PUT');
    await other.getByRole('button', { name: '保存草稿', exact: true }).click();
    expect((await conflicted).status()).toBe(412);
    await expect(other.getByLabel('公开昵称', { exact: true })).toHaveValue('并发窗口保留的输入');
    await other.getByRole('button', { name: '读取最新资料并保留输入', exact: true }).click();
    await expect(other.getByRole('heading', { name: '核对服务器草稿', exact: true })).toBeVisible();
    await other.getByRole('button', { name: '保留输入并采用最新修订', exact: true }).click();
    await other.getByRole('tab', { name: '审核历史', exact: true }).click();
    await other.getByRole('tab', { name: '编辑资料', exact: true }).click();
    await expect(other.getByLabel('公开昵称', { exact: true })).toHaveValue('并发窗口保留的输入');
    let responseInterrupted = false;
    await other.route('**/api/v1/me/profile', async (route) => {
      if (route.request().method() !== 'PUT' || responseInterrupted) {
        await route.continue();
        return;
      }
      responseInterrupted = true;
      const result = await route.fetch();
      expect(result.status()).toBe(200);
      await route.abort('connectionreset');
    });
    await other.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(
      other.getByText('资料服务暂时不可用，输入已保留，请核对结果后重试', { exact: true }),
    ).toBeVisible();
    await expect(other.getByLabel('公开昵称', { exact: true })).toHaveValue('并发窗口保留的输入');
    const own = OwnProfileResponseSchema.parse(
      await (await other.request.get('/api/v1/me/profile')).json(),
    );
    expect(own.data.revision).toBe(3);
    expect(own.data.content.displayName).toBe('并发窗口保留的输入');
    await other.getByRole('button', { name: '读取最新资料并保留输入', exact: true }).click();
    await other.getByRole('button', { name: '保留输入并采用最新修订', exact: true }).click();
    await save(other);
  } finally {
    await other.close();
  }
});

test('管理员自审在原页完成真实MFA近期验证，意见和确认保留且不自动重放', async ({ page }) => {
  const administrator = await loginBrowserAdmin(page);
  const identity = AuthContextResponseSchema.parse(
    await (await page.request.get('/api/v1/auth/context')).json(),
  ).data.account;
  if (!identity) throw Error('缺少实际管理员身份');
  expect(
    (
      await browserWrite(
        page,
        '/api/v1/me/profile',
        { content: profile('管理员本人公开资料'), expectedRevision: 0 },
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
  const id = ProfileSubmissionResponseSchema.parse(await submitted.json()).data.id;
  await page.goto('/admin/profiles?submission=' + id);
  const panel = page.getByRole('dialog', { name: '审核公开资料', exact: true });
  await expect(panel).toBeVisible();
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test'))
    throw Error('近期验证场景只允许自身隔离测试库');
  const database = createDatabase(source);
  try {
    await database.pool.query(
      "UPDATE auth_sessions SET mfa_verified_at=now()-interval '11 minutes' WHERE user_id=$1 AND revoked_at IS NULL",
      [identity.id],
    );
  } finally {
    await database.close();
  }
  await panel
    .getByLabel('给作者的处理说明', { exact: true })
    .fill('本人资料自审说明，验证后仍需保留');
  const checked = panel.getByRole('checkbox', {
    name: '确认这是我本人的资料并同意自审',
    exact: true,
  });
  await checked.check();
  await panel.getByRole('button', { name: '核对审核操作', exact: true }).click();
  const rejected = response(page, '/api/v1/admin/profiles/submissions/' + id + '/review', 'POST');
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '确认执行资料处理', exact: true })
    .click();
  const failure = await rejected;
  expect(failure.status()).toBe(403);
  expect(ErrorResponseSchema.parse(await failure.json()).error.code).toBe('MFA_REQUIRED');

  const verification = page.getByRole('dialog', { name: '验证高危操作', exact: true });
  await expect(verification).toBeVisible();
  await expect(panel).toHaveCount(0);
  await verification
    .getByLabel('动态验证码或恢复码', { exact: true })
    .fill(administrator.recoveryCode);
  await verification.getByRole('button', { name: '确认身份', exact: true }).click();
  await expect(verification).not.toBeVisible();
  await expect(panel.getByLabel('给作者的处理说明', { exact: true })).toHaveValue(
    '本人资料自审说明，验证后仍需保留',
  );
  await expect(checked).toBeChecked();
  const beforeRetry = OwnProfileResponseSchema.parse(
    await (await page.request.get('/api/v1/me/profile')).json(),
  );
  expect(beforeRetry.data.latestSubmission?.status).toBe('PENDING');
  await panel.getByRole('button', { name: '核对审核操作', exact: true }).click();
  const accepted = response(page, '/api/v1/admin/profiles/submissions/' + id + '/review', 'POST');
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '确认执行资料处理', exact: true })
    .click();
  expect((await accepted).status()).toBe(200);
});

test('公开资料举报从真实主页进入，后台处置隐藏公开头像并保留私有冻结证据', async ({
  page,
  browser,
}, info) => {
  await loginCreator(page);
  const options = {
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    viewport: page.viewportSize(),
  };
  const authorContext = await browser.newContext(options),
    adminContext = await browser.newContext(options),
    visitorContext = await browser.newContext(options);
  const author = await authorContext.newPage(),
    admin = await adminContext.newPage(),
    visitor = await visitorContext.newPage();
  const directory = join('data/tests/profiles/report', info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  try {
    const creator = await loginCreator(author);
    await loginBrowserAdmin(admin);
    const auth = AuthContextResponseSchema.parse(
      await (await author.request.get('/api/v1/auth/context')).json(),
    );
    if (!auth.data.account) throw Error('缺少实际资料作者');
    const uploaded = await author.request.post('/api/v1/me/assets/upload/avatar', {
      headers: { Origin: options.baseURL, 'X-CSRF-Token': auth.data.csrfToken },
      multipart: {
        file: { name: 'profile-report.png', mimeType: 'image/png', buffer: fixturePng },
      },
    });
    expect(uploaded.status()).toBe(200);
    const avatarId = AssetResponseSchema.parse(await uploaded.json()).data.id;
    const content = {
      ...profile('举报资料对象 ' + randomUUID().slice(0, 8)),
      avatarAssetId: avatarId,
    };
    expect(
      (
        await browserWrite(author, '/api/v1/me/profile', { content, expectedRevision: 0 }, 'PUT')
      ).status(),
    ).toBe(200);
    const submitted = await browserWrite(
      author,
      '/api/v1/me/profile/submissions',
      { expectedDraftRevision: 1, confirmed: true },
      'POST',
      nonce(),
    );
    expect(submitted.status()).toBe(200);
    const approvedId = ProfileSubmissionResponseSchema.parse(await submitted.json()).data.id;
    expect(
      (
        await browserWrite(
          admin,
          '/api/v1/admin/profiles/submissions/' + approvedId + '/review',
          {
            decision: 'approve',
            expectedRevision: 1,
            reason: '受控资料已核验',
            selfReviewConfirmed: false,
          },
          'POST',
          nonce(),
        )
      ).status(),
    ).toBe(200);
    await page.goto('/users/' + creator.username);
    await page.getByRole('button', { name: '举报公开资料', exact: true }).click();
    const form = page.getByRole('dialog', { name: '举报公开资料', exact: true });
    await form.getByLabel('补充说明', { exact: true }).fill('只提供给管理员的资料核验线索');
    const sent = response(page, '/api/v1/reports', 'POST');
    await form.getByRole('button', { name: '提交举报', exact: true }).click();
    const created = await sent;
    expect(created.status()).toBe(200);
    const report = OwnReportResponseSchema.parse(await created.json()).data;
    await form.getByRole('link', { name: '查看这条举报', exact: true }).click();
    const own = page.getByRole('dialog', { name: '举报详情', exact: true });
    await expect(own.getByRole('img', { name: '举报提交时的获批头像', exact: true })).toBeVisible();
    expect((await author.request.get('/api/v1/me/reports/' + report.id)).status()).toBe(404);
    await admin.goto('/admin/reports?report=' + report.id);
    const panel = admin.getByRole('dialog', { name: '处理举报', exact: true });
    await panel.getByRole('button', { name: '关联管理入口', exact: true }).click();
    await expect(panel.getByRole('link', { name: '管理公开资料', exact: true })).toHaveAttribute(
      'href',
      '/admin/profiles?status=all&submission=' + approvedId,
    );
    await panel.getByRole('button', { name: '完成处理', exact: true }).click();
    await panel.getByLabel('举报人可见说明', { exact: true }).fill('已核验并暂时隐藏资料');
    await panel.getByLabel('内容处置', { exact: true }).click();
    await admin.getByRole('option', { name: '隐藏公开资料', exact: true }).click();
    await panel
      .getByLabel('被处置者可见说明', { exact: true })
      .fill('请调整公开资料，作品不随本次操作下架');
    await panel.getByRole('button', { name: '核对处理操作', exact: true }).click();
    const handled = response(admin, '/api/v1/admin/reports/' + report.id + '/actions', 'POST');
    await admin
      .getByRole('alertdialog')
      .getByRole('button', { name: '确认保存处理记录', exact: true })
      .click();
    expect((await handled).status()).toBe(200);
    await visitor.goto('/users/' + creator.username);
    await expect(
      visitor.getByRole('heading', { level: 1, name: creator.username, exact: true }),
    ).toBeVisible();
    expect(
      (
        await visitor.request.get('/api/v1/users/' + creator.username + '/avatar/' + approvedId)
      ).status(),
    ).toBe(404);
    const evidence = await page.request.get('/api/v1/me/reports/' + report.id + '/avatar');
    expect(evidence.status()).toBe(200);
    expect(evidence.headers()['cache-control']).toContain('no-store');
    await page.reload();
    await expect(
      page
        .getByRole('dialog', { name: '举报详情', exact: true })
        .getByRole('img', { name: '举报提交时的获批头像', exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: join(directory, 'private-frozen-evidence.png') });
  } finally {
    await authorContext.close();
    await adminContext.close();
    await visitorContext.close();
  }
});
