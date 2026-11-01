import { randomUUID } from 'node:crypto';
import { test as base, expect, type Page } from '@playwright/test';
import { createDatabase } from '@personamarket/database';
import { createAdministrator } from '@personamarket/server';
import {
  CreationSettingsResponseSchema,
  DraftResponseSchema,
  SubmissionResponseSchema,
  PersonaDraftSchema,
  defaultCreationSettings,
  defaultSubmissionPendingHint,
} from '@personamarket/contracts';
import { browserWrite, loginCreator } from '../fixtures/browser-account.js';
import { logoutAccount, selectAccountNavigation } from '../fixtures/account-navigation.js';

const endpoint = '/api/v1/admin/settings/creation';
const origin = () => process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100';
const test = base.extend<{ administrator: { username: string; password: string }; creator: Page }>({
  administrator: [
    async ({ page }, use) => {
      const source = process.env['TEST_DATABASE_URL'];
      if (!source || !/^\/pm_e2e_[a-f0-9]{32}_test$/.test(new URL(source).pathname))
        throw new Error('待审提示E2E仅允许本轮受控隔离库');
      const username = 'hint_admin_' + randomUUID().replaceAll('-', '').slice(0, 12);
      const password = 'Hint administrator browser passphrase 2026';
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
      expect(
        (
          await browserWrite(page, '/api/v1/auth/login', { identifier: username, password })
        ).status(),
      ).toBe(200);
      const current = CreationSettingsResponseSchema.parse(
        await (await page.request.get(endpoint)).json(),
      );
      expect(
        (
          await browserWrite(
            page,
            endpoint,
            {
              data: defaultCreationSettings,
              expected: current.meta,
              reason: '初始化独立浏览器投稿设置',
            },
            'PATCH',
            { 'Idempotency-Key': randomUUID() },
          )
        ).status(),
      ).toBe(200);
      await use({ username, password });
    },
    { auto: true },
  ],
  creator: async ({ browser, page }, use) => {
    const context = await browser.newContext({
      baseURL: origin(),
      viewport: page.viewportSize() ?? { width: 390, height: 844 },
      reducedMotion: 'reduce',
      hasTouch: test.info().project.name === 'mobile',
      isMobile: test.info().project.name === 'mobile',
    });
    try {
      const author = await context.newPage();
      await loginCreator(author);
      await use(author);
    } finally {
      await context.close();
    }
  },
});
test.use({ trace: 'off', screenshot: 'off' });
test.beforeEach(async ({ page }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
});
async function current(page: Page) {
  return CreationSettingsResponseSchema.parse(await (await page.request.get(endpoint)).json());
}
async function changeHint(page: Page, pendingHint: string) {
  const previous = await current(page);
  const response = await browserWrite(
    page,
    endpoint,
    {
      data: { ...previous.data, submissions: { ...previous.data.submissions, pendingHint } },
      expected: previous.meta,
      reason: '隔离浏览器调整当前待审提示',
    },
    'PATCH',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(response.status()).toBe(200);
  return CreationSettingsResponseSchema.parse(await response.json());
}
async function fill(page: Page, pendingHint: string, reason: string) {
  await page.getByLabel('待审提示', { exact: true }).fill(pendingHint);
  await page.getByLabel('处理理由', { exact: true }).fill(reason);
}
async function confirmSave(page: Page) {
  await page.getByRole('button', { name: '保存创作设置', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: '确认保存创作设置', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '确认并保存', exact: true }).click();
  await expect(dialog).toBeHidden();
}
async function settingsNavigation(page: Page, name: string) {
  const selector = page.getByRole('button', { name: '选择设置分组', exact: true });
  if (await selector.isVisible()) await selector.click();
  const link = page.getByRole('link', { name, exact: true });
  const href = await link.getAttribute('href');
  if (!href) throw new Error('设置分组缺少真实目标');
  page.once('dialog', (dialog) => dialog.accept());
  await link.click();
  await expect(page).toHaveURL(new URL(href, origin()).href);
  await expect(page.getByRole('dialog', { name: '网站设置', exact: true })).toBeHidden();
}

test('待审提示默认差异只列变化项，取消保留输入，冲突核对后明确保存并记录真实差异', async ({
  page,
}) => {
  await page.goto('/admin/settings/creation');
  const maibot = page.getByRole('checkbox', { name: 'MaiBot', exact: true });
  const astrbot = page.getByRole('checkbox', { name: 'AstrBot', exact: true });
  await page.getByLabel('处理理由', { exact: true }).fill('核对字段错误后恢复平台选择');
  await maibot.uncheck();
  await astrbot.uncheck();
  await page.getByRole('button', { name: '保存创作设置', exact: true }).click();
  await expect(page.getByText('请至少选择一个投稿平台', { exact: true })).toBeVisible();
  await expect(maibot).toBeFocused();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await maibot.check();
  await astrbot.check();
  await expect(page.getByText('请至少选择一个投稿平台', { exact: true })).toHaveCount(0);
  const candidate = '**普通文本提示**\n保留待审期间的新输入 ' + randomUUID().slice(0, 8);
  const reason = '核对自定义提示与默认差异';
  await fill(page, candidate, reason);
  await page.getByRole('button', { name: '恢复默认值', exact: true }).click();
  const defaults = page.getByRole('alertdialog', { name: '恢复创作默认值', exact: true });
  await expect(defaults.getByRole('region', { name: '创作默认值差异', exact: true })).toContainText(
    candidate,
  );
  await expect(defaults).toContainText(defaultSubmissionPendingHint);
  await defaults.getByRole('button', { name: '保留当前输入', exact: true }).click();
  await expect(page.getByLabel('待审提示', { exact: true })).toHaveValue(candidate);
  await expect(page.getByLabel('处理理由', { exact: true })).toHaveValue(reason);
  await page.getByRole('button', { name: '恢复默认值', exact: true }).click();
  await defaults.getByRole('button', { name: '应用到表单', exact: true }).click();
  await expect(page.getByLabel('待审提示', { exact: true })).toHaveValue(
    defaultSubmissionPendingHint,
  );
  await expect(page.getByLabel('处理理由', { exact: true })).toHaveValue(reason);
  await page.getByRole('button', { name: '恢复默认值', exact: true }).click();
  await expect(defaults).toContainText('当前输入已是默认值，没有需要替换的设置');
  await defaults.getByRole('button', { name: '保留当前输入', exact: true }).click();
  await fill(page, candidate, reason);
  await changeHint(page, '另一份真实请求已经更新提示');
  await confirmSave(page);
  await expect(page.getByText('创作设置已被更新，请核对最新修订', { exact: true })).toBeVisible();
  await expect(page.getByLabel('待审提示', { exact: true })).toHaveValue(candidate);
  await expect(page.getByLabel('处理理由', { exact: true })).toHaveValue(reason);
  await page.getByRole('button', { name: '核对最新创作设置', exact: true }).click();
  await expect(page.getByText('另一份真实请求已经更新提示', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '采用最新修订保留输入', exact: true }).click();
  await page.getByRole('button', { name: '保存创作设置', exact: true }).click();
  const confirmation = page.getByRole('alertdialog', { name: '确认保存创作设置', exact: true });
  await confirmation.getByRole('button', { name: '返回核对', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存创作设置', exact: true })).toBeFocused();
  await confirmSave(page);
  await expect(
    page.getByText('创作设置已保存，待审版本在重新读取时使用当前提示', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '核对最新创作设置', exact: true })).toBeFocused();
  expect((await current(page)).data.submissions.pendingHint).toBe(candidate);
  await page.getByRole('button', { name: '查看投稿策略修改记录', exact: true }).click();
  await page.getByRole('button', { name: '查看投稿修改差异', exact: true }).first().click();
  await expect(page.getByRole('region', { name: '投稿策略修改记录', exact: true })).toContainText(
    candidate,
  );
  await expect(page.getByRole('region', { name: '投稿策略修改记录', exact: true })).toContainText(
    '另一份真实请求已经更新提示',
  );
  const success = page.getByText('创作设置已保存，待审版本在重新读取时使用当前提示', {
    exact: true,
  });
  await expect(success).toBeVisible();
  await fill(page, '成功后另一次尚未保存的候选', '核对新失败不会沿用上次成功反馈');
  await changeHint(page, '另一个窗口在上次成功后写入的当前提示');
  await confirmSave(page);
  await expect(page.getByText('创作设置已被更新，请核对最新修订', { exact: true })).toBeVisible();
  await expect(success).toHaveCount(0);
  await expect(page.getByLabel('待审提示', { exact: true })).toHaveValue(
    '成功后另一次尚未保存的候选',
  );
});

test('网络结果未知后跨设置页保留原请求和后续输入，显式核对复用幂等标识且不增加修订', async ({
  page,
}) => {
  await page.goto('/admin/settings/creation');
  const original = '原提交待审提示 ' + randomUUID().slice(0, 8),
    later = '随后编辑的新提示 ' + randomUUID().slice(0, 8);
  await fill(page, original, '第一份原处理理由');
  let firstKey: string | undefined, replayKey: string | undefined;
  await page.route('**/api/v1/admin/settings/creation', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    firstKey = route.request().headers()['idempotency-key'];
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort('failed');
  });
  await confirmSave(page);
  await expect(page.getByRole('button', { name: '核对原提交结果', exact: true })).toBeVisible();
  await fill(page, later, '后续输入的新理由');
  await settingsNavigation(page, '站点品牌');
  await settingsNavigation(page, '创作与投稿');
  await expect(page.getByLabel('待审提示', { exact: true })).toHaveValue(later);
  await expect(page.getByLabel('处理理由', { exact: true })).toHaveValue('后续输入的新理由');
  await expect(page.getByText('原待审提示：' + original, { exact: true })).toBeVisible();
  const before = await current(page);
  await page.unroute('**/api/v1/admin/settings/creation');
  let blockReplay = true;
  await page.route('**/api/v1/admin/settings/creation', async (route) => {
    if (route.request().method() === 'PATCH') {
      replayKey = route.request().headers()['idempotency-key'];
      if (blockReplay) {
        blockReplay = false;
        return route.fulfill({
          status: 429,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'RATE_LIMITED',
              message: '隔离浏览器核对请求暂时受限',
              fieldErrors: [],
              requestId: randomUUID(),
            },
          }),
        });
      }
    }
    await route.continue();
  });
  await page.getByRole('button', { name: '核对原提交结果', exact: true }).click();
  await expect(page.getByText('隔离浏览器核对请求暂时受限', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '核对原提交结果', exact: true })).toBeEnabled();
  await expect(page.getByText('原待审提示：' + original, { exact: true })).toBeVisible();
  await expect(page.getByLabel('处理理由', { exact: true })).toHaveValue('后续输入的新理由');
  expect(replayKey).toBe(firstKey);
  await page.getByRole('button', { name: '核对原提交结果', exact: true }).click();
  await expect(
    page.getByText('原提交结果已核实，后续输入仍保留，请再次核对后保存', { exact: true }),
  ).toBeVisible();
  expect(firstKey).toBeTruthy();
  expect(replayKey).toBe(firstKey);
  expect((await current(page)).meta).toEqual(before.meta);
  await expect(page.getByLabel('待审提示', { exact: true })).toHaveValue(later);
  await expect(page.getByLabel('处理理由', { exact: true })).toHaveValue('后续输入的新理由');
  await confirmSave(page);
  expect((await current(page)).data.submissions.pendingHint).toBe(later);
});

async function draft(author: Page, platform: 'maibot' | 'astrbot') {
  const created = await browserWrite(author, '/api/v1/me/personas', {
    platform,
    title: '待审提示 ' + platform + ' ' + randomUUID().slice(0, 8),
  });
  expect(created.status()).toBe(200);
  const item = DraftResponseSchema.parse(await created.json());
  const value = PersonaDraftSchema.parse({
    ...item.data.draft,
    summary: '独立浏览器验收作品',
    rightsAccepted: true,
    content:
      platform === 'maibot'
        ? { personality: '喜欢自然与文学', replyStyle: '自然亲切', behaviorStyle: '认真倾听' }
        : { systemPrompt: '记录旅途的故事', dialoguePairs: [] },
  });
  expect(
    (
      await browserWrite(author, '/api/v1/me/personas/' + item.data.id + '/draft', value, 'PUT', {
        'If-Match': '"draft-1"',
      })
    ).status(),
  ).toBe(200);
  return item.data.id;
}
async function approve(admin: Page, id: string) {
  expect(
    (
      await browserWrite(
        admin,
        '/api/v1/admin/moderation/submissions/' + id + '/review',
        {
          action: 'approve',
          expectedRevision: 1,
          reason: '完成真实待审流程',
          selfReviewConfirmed: false,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status(),
  ).toBe(200);
}

test('两平台真实PENDING才显示纯文本提示，空值隐藏说明，选中旧批准版隔离，状态已处理404不冒充新等待', async ({
  page,
  creator,
}) => {
  const text = '**仅按纯文本显示**\n待审时可以继续保留草稿 ' + randomUUID().slice(0, 8);
  await changeHint(page, text);
  const maibot = await draft(creator, 'maibot');
  const first = await browserWrite(
    creator,
    '/api/v1/me/personas/' + maibot + '/releases',
    { version: '1.0.0', changelog: '旧公开版本', expectedDraftRevision: 2, confirmed: true },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(first.status()).toBe(200);
  const old = SubmissionResponseSchema.parse(await first.json()).data;
  await approve(page, old.id);
  const records: Array<{ id: string; submissionId: string }> = [];
  for (const [platform, id, version] of [
    ['maibot', maibot, '1.1.0'],
    ['astrbot', await draft(creator, 'astrbot'), '1.0.0'],
  ] as const) {
    await creator.goto('/dashboard/personas/' + id + '/edit');
    await creator.getByRole('button', { name: '创建 Release', exact: true }).click();
    const sheet = creator.getByRole('dialog', { name: '确认本次发版', exact: true });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[data-pending-submission-hint]')).toHaveCount(0);
    await creator.getByLabel('版本号', { exact: true }).fill(version);
    await creator
      .getByLabel('更新日志', { exact: true })
      .fill('真实 ' + platform + ' 待审提示流程');
    await creator
      .getByRole('checkbox', {
        name: '我已核对公开内容、版本号及来源许可，确认提交审核',
        exact: true,
      })
      .click();
    const response = creator.waitForResponse(
      (result) =>
        result.url().includes('/me/personas/' + id + '/releases') &&
        result.request().method() === 'POST',
    );
    await creator.getByRole('button', { name: '确认提交审核', exact: true }).click();
    const submitted = await response;
    expect(submitted.status()).toBe(200);
    const submission = SubmissionResponseSchema.parse(await submitted.json()).data;
    await expect(sheet).toBeHidden();
    await expect(
      creator.locator('[data-pending-submission-hint="' + submission.id + '"]'),
    ).toContainText(text);
    await expect(creator.locator('[data-pending-submission-hint] strong')).toHaveCount(0);
    records.push({ id, submissionId: submission.id });
  }
  const astrbot = records[1];
  if (!astrbot) throw new Error('缺少AstrBot真实待审版本');
  await changeHint(page, '更新后的当前待审说明');
  const hintPattern = '**/api/v1/me/submissions/' + astrbot.submissionId + '/pending-hint';
  let firstRead = true;
  await creator.route(hintPattern, async (route) => {
    if (!firstRead) return route.continue();
    firstRead = false;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: '隔离浏览器提示读取暂不可用',
          fieldErrors: [],
          requestId: randomUUID(),
        },
      }),
    });
  });
  await creator.goto('/dashboard/personas/' + astrbot.id + '/releases');
  await expect(creator.locator('[data-pending-hint-state="error"]')).toContainText(
    '隔离浏览器提示读取暂不可用',
  );
  await expect(creator.locator('[data-pending-submission-hint]')).toHaveCount(0);
  await creator.getByRole('button', { name: '重新读取待审提示', exact: true }).click();
  await expect(creator.locator('[data-pending-submission-hint]')).toContainText(
    '更新后的当前待审说明',
  );
  await creator.unroute(hintPattern);
  await changeHint(page, '');
  const empty = creator.waitForResponse((response) =>
    response.url().endsWith('/api/v1/me/submissions/' + astrbot.submissionId + '/pending-hint'),
  );
  await creator.reload();
  expect((await empty).status()).toBe(200);
  await expect(creator.getByText('正在读取待审提示…', { exact: true })).toHaveCount(0);
  await expect(creator.getByText('待审核', { exact: true }).first()).toBeVisible();
  await expect(creator.locator('[data-pending-submission-hint]')).toHaveCount(0);
  await expect(creator.getByRole('button', { name: '撤回审核', exact: true })).toBeVisible();
  await changeHint(page, text);
  await creator.goto('/dashboard/personas/' + maibot + '/releases?submission=' + old.id);
  await expect(
    creator.getByRole('heading', { name: 'v1.0.0 的审核快照', exact: true }),
  ).toBeVisible();
  await expect(creator.locator('[data-pending-submission-hint]')).toHaveCount(0);
  const pending = records[0];
  if (!pending) throw new Error('缺少MaiBot真实待审版本');
  let release = () => {},
    captured = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    captured = resolve;
  });
  const pattern = new RegExp('/api/v1/me/personas/' + maibot + '/releases(?:\\?|$)');
  await creator.route(pattern, async (route) => {
    const result = await route.fetch();
    expect(result.status()).toBe(200);
    captured();
    await held;
    await route.fulfill({ response: result });
  });
  try {
    const navigation = creator.goto('/dashboard/personas/' + maibot + '/releases');
    await ready;
    await approve(page, pending.submissionId);
    release();
    await navigation;
    await expect(creator.locator('[data-pending-hint-state="ended"]')).toContainText(
      '审核状态有更新',
    );
    await expect(creator.locator('[data-pending-submission-hint]')).toHaveCount(0);
    await creator.unroute(pattern);
    await creator.getByRole('link', { name: '查看发布记录', exact: true }).click();
    await expect(
      creator.getByRole('heading', { name: 'v1.1.0 的审核快照', exact: true }),
    ).toBeVisible();
    await expect(creator.locator('[data-pending-hint-state="ended"]')).toHaveCount(0);
  } finally {
    release();
    await creator.unroute(pattern);
  }
});

test('另一个标签页退出后，迟到的真实保存响应不恢复私有草稿或旧处理理由', async ({
  page,
  administrator,
}) => {
  await page.goto('/admin/settings/creation');
  const heapMarker = randomUUID();
  await page.evaluate((marker) => {
    Object.defineProperty(window, '__submissionHintTestHeap', {
      value: marker,
      configurable: true,
    });
  }, heapMarker);
  const reason = '会话结束前的原处理理由 ' + randomUUID().slice(0, 8);
  await fill(page, '会话结束前已提交的真实提示', reason);
  let release = () => {},
    captured = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    captured = resolve;
  });
  await page.route('**/api/v1/admin/settings/creation', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    const result = await route.fetch();
    expect(result.status()).toBe(200);
    captured();
    await held;
    await route.fulfill({ response: result });
  });
  const control = await page.context().newPage();
  try {
    await page.getByRole('button', { name: '保存创作设置', exact: true }).click();
    await page
      .getByRole('alertdialog', { name: '确认保存创作设置', exact: true })
      .getByRole('button', { name: '确认并保存', exact: true })
      .click();
    await ready;
    await control.goto('/account');
    await logoutAccount(control);
    await expect(page.getByLabel('待审提示', { exact: true })).toHaveCount(0);
    const received = page.waitForResponse(
      (response) => response.url().endsWith(endpoint) && response.request().method() === 'PATCH',
    );
    release();
    expect((await received).status()).toBe(200);
    await expect(page.getByLabel('待审提示', { exact: true })).toHaveCount(0);
    await control.goto('/login');
    await control.getByLabel('用户名或邮箱').fill(administrator.username);
    await control.getByLabel('密码', { exact: true }).fill(administrator.password);
    await control.getByRole('button', { name: '登录', exact: true }).click();
    await expect(control).toHaveURL(/\/account$/);
    // 显式退出会让其他标签返回首页；经真实客户端导航返回，避免整页重载掩盖私有缓存问题。
    await selectAccountNavigation(page, '站点设置');
    await expect(page.getByRole('heading', { name: '站点品牌设置', exact: true })).toBeVisible();
    await settingsNavigation(page, '创作与投稿');
    expect(await page.evaluate(() => Reflect.get(window, '__submissionHintTestHeap'))).toBe(
      heapMarker,
    );
    await expect(page.getByLabel('待审提示', { exact: true })).toHaveValue(
      '会话结束前已提交的真实提示',
    );
    await expect(page.getByLabel('处理理由', { exact: true })).toHaveValue('');
    await expect(page.getByText(reason, { exact: true })).toHaveCount(0);
  } finally {
    release();
    await control.close();
    await page.unroute('**/api/v1/admin/settings/creation');
  }
});
