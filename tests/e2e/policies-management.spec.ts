import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { createDatabase } from '@personamarket/database';
import { createAdministrator } from '@personamarket/server';
import {
  AdminPolicyResponseSchema,
  PolicyRecordsResponseSchema,
  policyEtag,
  type PolicySlug,
} from '@personamarket/contracts';
import { browserWrite } from '../fixtures/browser-account.js';

test.use({ trace: 'off', screenshot: 'off' });
const endpoint = (slug: PolicySlug) => '/api/v1/admin/settings/policies/' + slug;
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  const messages: string[] = [];
  errors.set(page, messages);
  page.on('pageerror', (error) => messages.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page) ?? []).toEqual([]);
});
function database() {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test'))
    throw Error('规则E2E只允许隔离测试数据库');
  return createDatabase(source);
}
async function login(page: Page) {
  const username = 'policy_ui_' + randomUUID().replaceAll('-', '').slice(0, 12);
  const password = 'A real policy administrator passphrase 2026';
  const db = database();
  try {
    await createAdministrator(db, { username, password, email: username + '@fixture.invalid' });
  } finally {
    await db.close();
  }
  await page.goto('/login');
  await page.getByLabel('用户名或邮箱').fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  const response = page.waitForResponse(
    (item) => item.url().endsWith('/api/v1/auth/login') && item.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '登录', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page).toHaveURL(/\/account$/);
  return { username, password };
}
async function read(page: Page, slug: PolicySlug) {
  const response = await page.request.get(endpoint(slug));
  expect(response.status()).toBe(200);
  return AdminPolicyResponseSchema.parse(await response.json()).data;
}
async function mutate(
  page: Page,
  slug: PolicySlug,
  revision: number,
  suffix: string,
  input: unknown,
  method = 'POST',
) {
  const response = await browserWrite(page, endpoint(slug) + suffix, input, method, {
    'If-Match': policyEtag(slug, revision),
    'Idempotency-Key': randomUUID(),
  });
  expect(response.status()).toBe(200);
  return AdminPolicyResponseSchema.parse(await response.json()).data;
}
async function clearPending(page: Page, slug: PolicySlug) {
  const value = await read(page, slug);
  if (value.latestSubmission?.status === 'pending')
    return mutate(
      page,
      slug,
      value.revision,
      '/submissions/' + value.latestSubmission.id + '/withdraw',
      { confirmed: true, reason: '开始独立用例，撤回上轮受控待审快照' },
    );
  return value;
}
async function navigateSettings(page: Page, name: string) {
  const trigger = page.getByRole('button', { name: '选择设置分组', exact: true });
  if (await trigger.isVisible()) await trigger.click();
  const link = page.getByRole('link', { name, exact: true });
  const href = await link.getAttribute('href');
  if (!href) throw Error('设置入口缺少路由');
  const target = new URL(href, page.url()).href;
  await link.click();
  await expect(page).toHaveURL(target);
  await expect(page.getByRole('dialog', { name: '网站设置', exact: true })).toBeHidden();
}

test('通过双管理员真实表单保存、预览、送审与他审公开，审批读取冻结快照', async ({
  page,
  browser,
}) => {
  await login(page);
  await clearPending(page, 'privacy');
  await page.goto('/admin/settings/policies?document=privacy');
  const title = '隐私说明 UI ' + randomUUID().slice(0, 8);
  const body = '## 实际冻结的说明\n\nUI_FROZEN_POLICY_' + randomUUID();
  await page.getByLabel('规则标题', { exact: true }).fill(title);
  await page.getByLabel('简短介绍', { exact: true }).fill('仅用于独立隔离环境的实际表单验收');
  await page.getByLabel('规则正文', { exact: true }).fill(body);
  const preview = page.getByRole('tab', { name: '查看预览', exact: true });
  if (await preview.isVisible()) {
    await preview.click();
    await expect(page.getByRole('region', { name: '草稿正文预览', exact: true })).toContainText(
      'UI_FROZEN_POLICY_',
    );
    await page.getByRole('tab', { name: '编辑正文', exact: true }).click();
    await expect(page.getByLabel('规则标题', { exact: true })).toHaveValue(title);
  }
  await page.getByRole('button', { name: '保存规则草稿', exact: true }).click();
  await expect(
    page.getByText('草稿已保存，公开版和已送审快照保持各自内容', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '提交规则审核', exact: true }).click();
  const submission = page.getByRole('alertdialog', { name: '提交规则审核', exact: true });
  await expect(submission).toContainText(title);
  await submission.getByLabel('处理理由', { exact: true }).fill('将这份已保存的草稿冻结送审');
  await submission.getByRole('button', { name: '返回核对', exact: true }).click();
  await expect(page.getByRole('button', { name: '提交规则审核', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '提交规则审核', exact: true }).click();
  await expect(submission.getByLabel('处理理由', { exact: true })).toHaveValue(
    '将这份已保存的草稿冻结送审',
  );
  await submission.getByRole('button', { name: '确认操作', exact: true }).click();
  await expect(submission).toBeHidden();
  const pending = (await read(page, 'privacy')).latestSubmission;
  expect(pending?.status).toBe('pending');
  if (!pending) throw Error('没有冻结快照');
  await page.getByLabel('规则正文', { exact: true }).fill(body + '\n\nNOT_IN_FROZEN_SNAPSHOT');
  await page.getByRole('button', { name: '保存规则草稿', exact: true }).click();
  await expect(
    page.getByText('草稿已保存，公开版和已送审快照保持各自内容', { exact: true }),
  ).toBeVisible();
  const context = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    viewport: page.viewportSize() ?? { width: 390, height: 844 },
  });
  try {
    const reviewer = await context.newPage();
    await login(reviewer);
    await reviewer.goto('/admin/settings/policies?document=privacy');
    await reviewer.getByRole('button', { name: '查看待审快照', exact: true }).click();
    const panel = reviewer.getByRole('dialog', { name: '规则送审快照', exact: true });
    await expect(panel).toContainText('UI_FROZEN_POLICY_');
    await expect(panel).not.toContainText('NOT_IN_FROZEN_SNAPSHOT');
    await panel.getByRole('button', { name: '批准并公开', exact: true }).click();
    const approval = reviewer.getByRole('alertdialog', { name: '批准并公开规则', exact: true });
    await expect(approval.getByRole('checkbox')).toHaveCount(0);
    await approval.getByRole('button', { name: '确认操作', exact: true }).click();
    await expect(approval).toBeHidden();
    expect((await read(reviewer, 'privacy')).published?.publicationId).toBe(pending.id);
    await expect(reviewer.getByRole('button', { name: '保存规则草稿', exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
  await page.goto('/privacy');
  await expect(page.locator('[data-policy-body]')).toContainText('UI_FROZEN_POLICY_');
  await expect(page.locator('[data-policy-body]')).not.toContainText('NOT_IN_FROZEN_SNAPSHOT');
});

test('私有输入在切换规则和设置组后保留，未保存状态与移动预览可达', async ({ page }) => {
  if ((page.viewportSize()?.width ?? 0) > 1024)
    await page.setViewportSize({ width: 1366, height: 768 });
  await login(page);
  await page.goto('/admin/settings/policies?document=terms');
  const title = '尚未提交的规则 ' + randomUUID().slice(0, 8);
  await page.getByLabel('规则标题', { exact: true }).fill(title);
  await expect(
    page.getByText('有未保存输入或待核对操作，在当前账号的页面间暂存，刷新页面后不保留', {
      exact: true,
    }),
  ).toBeVisible();
  const nav = page.getByRole('navigation', { name: '选择公共规则', exact: true });
  await nav.getByRole('link', { name: '隐私说明', exact: true }).click();
  await expect(page).toHaveURL(/document=privacy/);
  await nav.getByRole('link', { name: '服务条款', exact: true }).click();
  await expect(page.getByLabel('规则标题', { exact: true })).toHaveValue(title);
  page.once('dialog', (dialog) => dialog.accept());
  await navigateSettings(page, '排行与运营');
  await expect(page.getByRole('heading', { name: '排行与运营', exact: true })).toBeVisible();
  await navigateSettings(page, '公共规则');
  const sidebar = page.locator('aside').filter({ hasText: '网站设置' });
  if (await sidebar.isVisible()) {
    expect(await sidebar.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
      true,
    );
    await expect(sidebar.getByRole('link', { name: '公共规则', exact: true })).toBeInViewport();
  }
  await expect(page.getByLabel('规则标题', { exact: true })).toHaveValue(title);
});

test('保存响应未知后保留原请求，换页和修改当前输入不改变幂等核对内容', async ({ page }) => {
  await login(page);
  await clearPending(page, 'terms');
  const records = async () =>
    PolicyRecordsResponseSchema.parse(
      await (await page.request.get(endpoint('terms') + '/records')).json(),
    );
  const before = await records();
  await page.goto('/admin/settings/policies?document=terms');
  const title = '原请求保存 ' + randomUUID().slice(0, 8);
  await page.getByLabel('规则标题', { exact: true }).fill(title);
  await page.getByLabel('规则正文', { exact: true }).fill('## 核对原请求\n\n这段正文只提交一次');
  let lost = false;
  await page.route('**' + endpoint('terms'), async (route) => {
    if (!lost && route.request().method() === 'PATCH') {
      lost = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: '保存规则草稿', exact: true }).click();
  await expect(
    page.getByText('公共规则暂时无法读取或保存，请核对状态后重试', { exact: true }),
  ).toBeVisible();
  const next = '核对期间继续输入 ' + randomUUID().slice(0, 8);
  await page.getByLabel('规则标题', { exact: true }).fill(next);
  await page
    .getByRole('navigation', { name: '选择公共规则' })
    .getByRole('link', { name: '隐私说明', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: '选择公共规则' })
    .getByRole('link', { name: '服务条款', exact: true })
    .click();
  await expect(page.getByLabel('规则标题', { exact: true })).toHaveValue(next);
  await page.getByRole('button', { name: '保存规则草稿', exact: true }).click();
  await expect(
    page.getByText('先前的保存已确认，新的修改已保留。再次点击保存即可提交。', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel('规则标题', { exact: true })).toHaveValue(next);
  expect((await read(page, 'terms')).title).toBe(title);
  expect((await records()).meta.total).toBe(before.meta.total + 1);
  await expect(page.getByRole('button', { name: '核对原提交结果', exact: true })).toHaveCount(0);
});

test('实际自审要求原地近期密码验证，验证完成保留理由且不自动重发审批', async ({ page }) => {
  const account = await login(page);
  let value = await clearPending(page, 'terms');
  value = await mutate(
    page,
    'terms',
    value.revision,
    '',
    {
      title: '自审核对 ' + randomUUID().slice(0, 8),
      summary: '隔离账号自审',
      bodyMarkdown: '## 自审说明\n\n只用于原地验证的受控业务流程',
      reason: '准备实际作者自己的送审快照',
    },
    'PATCH',
  );
  value = await mutate(page, 'terms', value.revision, '/submissions', {
    confirmed: true,
    reason: '准备本人参与的冻结快照',
  });
  const pending = value.latestSubmission;
  if (!pending) throw Error('没有自审快照');
  const db = database();
  try {
    await db.pool.query(
      "UPDATE auth_sessions SET created_at=clock_timestamp()-interval '20 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1) AND revoked_at IS NULL",
      [account.username],
    );
  } finally {
    await db.close();
  }
  await page.goto('/admin/settings/policies?document=terms');
  await expect(page.getByLabel('规则标题', { exact: true })).toBeInViewport();
  await page.getByRole('button', { name: '查看待审快照', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '规则送审快照', exact: true });
  await panel.getByRole('button', { name: '批准并公开', exact: true }).click();
  const approval = page.getByRole('alertdialog', { name: '批准并公开规则', exact: true });
  await approval
    .getByLabel('处理理由', { exact: true })
    .fill('我核对了自己参与的冻结内容并承担自审责任');
  await approval
    .getByRole('checkbox', { name: '我确认以管理员身份自审这份快照', exact: true })
    .check();
  await approval.getByRole('button', { name: '确认操作', exact: true }).click();
  await approval.getByRole('button', { name: '验证高危操作', exact: true }).click();
  const verification = page.getByRole('dialog', { name: '验证高危操作', exact: true });
  await verification.getByLabel('当前登录密码', { exact: true }).fill(account.password);
  await verification.getByRole('button', { name: '确认身份', exact: true }).click();
  await expect(verification).toBeHidden();
  await expect(approval.getByText('身份已确认', { exact: true })).toBeVisible();
  await expect(approval.getByLabel('处理理由', { exact: true })).toHaveValue(
    '我核对了自己参与的冻结内容并承担自审责任',
  );
  expect((await read(page, 'terms')).latestSubmission?.status).toBe('pending');
  await approval.getByRole('button', { name: '确认操作', exact: true }).click();
  await expect(approval).toBeHidden();
  expect((await read(page, 'terms')).published?.publicationId).toBe(pending.id);
});

test('未知操作核对后保留后来输入的下一次送审理由', async ({ page }) => {
  await login(page);
  let value = await clearPending(page, 'terms');
  value = await mutate(
    page,
    'terms',
    value.revision,
    '',
    {
      title: '送审理由保留 ' + randomUUID().slice(0, 8),
      summary: '',
      bodyMarkdown: '## 已保存的规则\n\n核对明确的下一轮处理理由',
      reason: '准备独立的状态保持回归',
    },
    'PATCH',
  );
  await page.goto('/admin/settings/policies?document=terms');
  await expect(page.getByLabel('规则标题', { exact: true })).toHaveValue(value.title);
  let lost = false;
  await page.route('**' + endpoint('terms') + '/submissions', async (route) => {
    if (!lost && route.request().method() === 'POST') {
      lost = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: '提交规则审核', exact: true }).click();
  const confirmation = page.getByRole('alertdialog', { name: '提交规则审核', exact: true });
  await confirmation.getByLabel('处理理由', { exact: true }).fill('R1 原始送审理由');
  await confirmation.getByRole('button', { name: '确认操作', exact: true }).click();
  await expect(confirmation.getByRole('button', { name: '确认操作', exact: true })).toBeDisabled();
  await expect(confirmation).toContainText('请求结果尚未确认，请返回页面核对原提交结果');
  await confirmation.getByLabel('处理理由', { exact: true }).fill('R2 后来输入的下一轮理由');
  await confirmation.getByRole('button', { name: '返回核对', exact: true }).click();
  await page.getByRole('button', { name: '核对原提交结果', exact: true }).click();
  await expect(page.getByRole('button', { name: '核对原提交结果', exact: true })).toHaveCount(0);
  const pending = await read(page, 'terms');
  if (!pending.latestSubmission) throw Error('缺少真实送审回执');
  await mutate(
    page,
    'terms',
    pending.revision,
    '/submissions/' + pending.latestSubmission.id + '/withdraw',
    { confirmed: true, reason: '撤回已核对送审，继续核对下一轮未提交理由' },
  );
  const nav = page.getByRole('navigation', { name: '选择公共规则' });
  await nav.getByRole('link', { name: '隐私说明', exact: true }).click();
  await expect(page).toHaveURL(/document=privacy/);
  await nav.getByRole('link', { name: '服务条款', exact: true }).click();
  await page.getByRole('button', { name: '提交规则审核', exact: true }).click();
  await expect(confirmation.getByLabel('处理理由', { exact: true })).toHaveValue(
    'R2 后来输入的下一轮理由',
  );
});

test('返回规则页面会显示其他管理员新提交的待审快照', async ({ page }) => {
  await login(page);
  let value = await clearPending(page, 'terms');
  value = await mutate(
    page,
    'terms',
    value.revision,
    '',
    {
      title: '采用修订状态 ' + randomUUID().slice(0, 8),
      summary: '',
      bodyMarkdown: '## 状态修订\n\n正文不变时仍须保留已经核对的送审状态',
      reason: '准备修订候选回归',
    },
    'PATCH',
  );
  await page.goto('/admin/settings/policies?document=terms');
  await expect(page.getByLabel('规则标题', { exact: true })).toHaveValue(value.title);
  await expect(page.getByRole('button', { name: '查看待审快照', exact: true })).toHaveCount(0);
  await mutate(page, 'terms', value.revision, '/submissions', {
    confirmed: true,
    reason: '从另一请求创建同正文的新送审状态',
  });
  await page.reload();
  await expect(page.getByRole('button', { name: '查看待审快照', exact: true })).toBeVisible();
  const nav = page.getByRole('navigation', { name: '选择公共规则', exact: true });
  await nav.getByRole('link', { name: '隐私说明', exact: true }).click();
  await expect(page).toHaveURL(/document=privacy/);
  await nav.getByRole('link', { name: '服务条款', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看待审快照', exact: true })).toBeVisible();
});
