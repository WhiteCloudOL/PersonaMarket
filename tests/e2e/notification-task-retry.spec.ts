import { randomUUID } from 'node:crypto';
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { eq, sql } from 'drizzle-orm';
import { createDatabase, notifications, outboxEvents } from '@personamarket/database';
import { createAdministrator, enqueueNotification } from '@personamarket/server';
import {
  AdminTaskListResponseSchema,
  AdminUserResponseSchema,
  AuthContextResponseSchema,
  NotificationDeliveryDetailResponseSchema,
  NotificationsResponseSchema,
} from '@personamarket/contracts';
import { browserWrite } from '../fixtures/browser-account.js';
import { loginSystemUser, expireSystemCredential } from '../fixtures/system-settings.js';
import { logoutAccount, selectAccountNavigation } from '../fixtures/account-navigation.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';

type Owned = {
  database: ReturnType<typeof createDatabase>;
  account: { id: string; username: string; password: string };
  receiver: { id: string; username: string };
  receiverPage: Page;
};
const endpoint = '/api/v1/admin/notifications';
const detailPath = (id: string) => endpoint + '/deliveries/' + id;
const test = base.extend<{ owned: Owned }>({
  owned: async ({ page, browser }, use) => {
    const source = process.env['TEST_DATABASE_URL'];
    if (!source || !/^\/pm_e2e_[a-f0-9]{32}_test$/.test(new URL(source).pathname))
      throw new Error('通知恢复E2E仅允许本轮受控隔离库');
    const database = createDatabase(source);
    let context: BrowserContext | undefined;
    try {
      const password = 'Owned notification browser passphrase 2026';
      const account = await createAdministrator(database, {
        username: 'notify_admin_' + randomUUID().replaceAll('-', '').slice(0, 10),
        email: randomUUID() + '@fixture.invalid',
        password,
      });
      const receiver = await createAdministrator(database, {
        username: 'notify_reader_' + randomUUID().replaceAll('-', '').slice(0, 10),
        email: randomUUID() + '@fixture.invalid',
        password,
      });
      await loginSystemUser(page, account.username, password);
      const response = await page.request.get('/api/v1/admin/users/' + receiver.id);
      expect(response.status()).toBe(200);
      const before = AdminUserResponseSchema.parse(await response.json()).data;
      expect(
        (
          await browserWrite(
            page,
            '/api/v1/admin/users/' + receiver.id + '/role',
            {
              role: 'user',
              expectedSecurityVersion: before.securityVersion,
              reason: '隔离正常浏览器夹具：普通站内通知接收者',
            },
            'PUT',
            { 'Idempotency-Key': randomUUID() },
          )
        ).status(),
      ).toBe(200);
      context = await browser.newContext({
        baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
        viewport: page.viewportSize(),
        reducedMotion: 'reduce',
      });
      const receiverPage = await context.newPage();
      await loginSystemUser(receiverPage, receiver.username, password);
      await use({ database, account: { ...account, password }, receiver, receiverPage });
    } finally {
      await context?.close();
      await database.close();
    }
  },
});
test.use({ trace: 'off', screenshot: 'off' });

/** 仅全新自有隔离行：真实生产enqueue+同事务合法终态，Worker看不到中间可派发状态。 */
async function failed(
  owned: Owned,
  kind: 'admin_notice' | 'profile_state' | 'account_security' = 'admin_notice',
) {
  return owned.database.db.transaction(async (tx) => {
    const id = await enqueueNotification(tx, {
      recipientId: owned.receiver.id,
      actorId: owned.account.id,
      sourceId: randomUUID(),
      kind,
      title: '隔离通知恢复 ' + randomUUID().slice(0, 8),
      message: '仅供自有隔离验收的通知原文，不进入精确运维详情',
      target:
        kind === 'admin_notice'
          ? { type: 'none' }
          : kind === 'account_security'
            ? { type: 'account' }
            : { type: 'own_profile' },
    });
    const [row] = await tx
      .select({ eventId: notifications.eventId })
      .from(notifications)
      .where(eq(notifications.id, id));
    if (!row) throw new Error('缺少刚生成的受控通知');
    await tx
      .update(outboxEvents)
      .set({ attempts: 5, leaseUntil: null, deliveredAt: null })
      .where(eq(outboxEvents.id, row.eventId));
    await tx
      .update(notifications)
      .set({
        status: 'failed',
        attempts: 5,
        errorCode: 'DELIVERY_FAILED',
        lastAttemptedAt: sql`clock_timestamp()`,
        completedAt: sql`clock_timestamp()`,
      })
      .where(eq(notifications.id, id));
    return id;
  });
}
async function current(page: Page, id: string) {
  const response = await page.request.get(detailPath(id));
  expect(response.status()).toBe(200);
  return NotificationDeliveryDetailResponseSchema.parse(await response.json()).data;
}
async function open(page: Page, id: string, query = '') {
  await page.goto('/admin/notifications?deliveryId=' + id + query);
  const panel = page.getByRole('dialog', { name: '通知投递详情', exact: true });
  await expect(panel.getByText('本轮投递失败', { exact: true })).toBeVisible();
  return panel;
}
async function confirm(page: Page) {
  await page.getByRole('button', { name: '重试投递', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: '确认重新投递这条通知', exact: true });
  await dialog.getByRole('button', { name: '确认重投', exact: true }).click();
  return dialog;
}
function unavailable() {
  return {
    error: {
      code: 'SERVICE_UNAVAILABLE',
      message: '隔离浏览器：本次应答无法确认',
      fieldErrors: [],
      requestId: randomUUID(),
    },
  };
}
async function assertOneRound(owned: Owned, id: string) {
  const rows = await owned.database.pool.query<{ amount: number }>(
    "SELECT count(*)::int AS amount FROM outbox_events WHERE topic='notification.deliver' AND payload->>'notificationId'=$1",
    [id],
  );
  expect(rows.rows[0]?.amount).toBe(2);
  expect(
    (await owned.database.pool.query('SELECT id FROM notifications WHERE id=$1', [id])).rowCount,
  ).toBe(1);
}

test('真实任务精确深链、普通业务无需追加近期验证、确认焦点及Worker送达可核对', async ({
  page,
  owned,
}) => {
  expect(
    (
      await browserWrite(
        owned.receiverPage,
        '/api/v1/me/profile',
        {
          content: {
            displayName: '自有通知接收人',
            bio: '正常私有资料用于通知目标',
            avatarAssetId: null,
            links: [],
          },
          expectedRevision: 0,
        },
        'PUT',
      )
    ).status(),
  ).toBe(200);
  const id = await failed(owned, 'profile_state');
  const noticeReads: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === endpoint + '/' + id)
      noticeReads.push(request.url());
  });
  await expireSystemCredential(owned.account.username, 'password');
  await page.goto('/admin/tasks?category=notifications&stage=dispatch&custom=preserved');
  const list = AdminTaskListResponseSchema.parse(
    await (
      await page.request.get('/api/v1/admin/tasks?category=notifications&stage=dispatch')
    ).json(),
  );
  const index = list.data.findIndex((row) => row.source === 'notification' && row.id === id);
  expect(index).toBeGreaterThanOrEqual(0);
  await page.getByRole('button', { name: '查看站内通知详情', exact: true }).nth(index).click();
  const task = page.getByRole('dialog', { name: '站内通知', exact: true });
  await expect(task).toContainText(id);
  await expect(task.getByRole('link', { name: '打开通知管理', exact: true })).toHaveAttribute(
    'href',
    '/admin/notifications?deliveryId=' + id,
  );
  await task.getByRole('link', { name: '打开通知管理', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '通知投递详情', exact: true });
  await expect(panel).toContainText(owned.receiver.username);
  await expect(panel.getByRole('button', { name: /管理员通知正文/ })).toHaveCount(0);
  await expect(panel.getByText(/^本次观测：/)).toContainText(/\d{2}:\d{2}:\d{2}/);
  await expect(panel.getByText(/^本次观测：/)).toContainText('北京时间');
  await panel.getByRole('button', { name: '重试投递', exact: true }).click();
  const cancel = page.getByRole('alertdialog', { name: '确认重新投递这条通知', exact: true });
  await cancel.getByRole('button', { name: '返回核对', exact: true }).click();
  await expect(panel.getByRole('button', { name: '重试投递', exact: true })).toBeFocused();
  await confirm(page);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '核对当前投递状态', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: '验证高危操作', exact: true })).toHaveCount(0);
  await expect.poll(async () => (await current(page, id)).status).toBe('delivered');
  await panel.getByRole('button', { name: '核对当前投递状态', exact: true }).click();
  await expect(panel.getByText('已送达站内通知', { exact: true })).toBeVisible();
  expect((await current(page, id)).currentEventProcessed).toBe(true);
  const inbox = NotificationsResponseSchema.parse(
    await (await owned.receiverPage.request.get('/api/v1/me/notifications')).json(),
  );
  expect(inbox.data.filter((row) => row.id === id)).toHaveLength(1);
  await assertOneRound(owned, id);
  expect(noticeReads).toHaveLength(0);
  expect((await page.request.get(endpoint + '/' + id)).status()).toBe(404);
  await page.goBack();
  await expect(page).toHaveURL(/category=notifications&stage=dispatch&custom=preserved$/);
});

test('实际受理后浏览器应答未知，关闭重开和SPA返回保留原请求，读取限流不触发重复写', async ({
  page,
  owned,
}) => {
  const id = await failed(owned);
  const bodyReads: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === endpoint + '/' + id)
      bodyReads.push(request.url());
  });
  await page.goto(
    '/admin/notifications?status=all&recipientId=' + owned.receiver.id + '&custom=preserved',
  );
  await page.evaluate(() => Reflect.set(window, 'notificationRetrySpaContext', true));
  await page.getByRole('tab', { name: '写通知', exact: true }).click();
  await page.getByLabel('通知标题', { exact: true }).fill('未提交的独立通知标题');
  await page.getByLabel('通知内容', { exact: true }).fill('切换精确详情后仍需保留的输入');
  await page.getByRole('tab', { name: '投递记录', exact: true }).click();
  const bindings: { key: string | undefined; body: unknown }[] = [];
  await page.route(
    '**' + endpoint + '/' + id + '/retry',
    async (route) => {
      bindings.push({
        key: route.request().headers()['idempotency-key'],
        body: route.request().postDataJSON(),
      });
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.fulfill({ status: 503, json: unavailable() });
    },
    { times: 1 },
  );
  await page.locator('[data-delivery-id="' + id + '"]').click();
  const panel = page.getByRole('dialog', { name: '通知投递详情', exact: true });
  await expect(panel.getByText('本轮投递失败', { exact: true })).toBeVisible();
  const originalText = '仅供自有隔离验收的通知原文，不进入精确运维详情';
  await expect(panel.getByText(originalText, { exact: true })).toHaveCount(0);
  expect(bodyReads).toHaveLength(0);
  let releaseBody = () => {},
    bodyStarted = () => {};
  const holdBody = new Promise<void>((resolve) => {
    releaseBody = resolve;
  });
  const startingBody = new Promise<void>((resolve) => {
    bodyStarted = resolve;
  });
  await page.route(
    '**' + endpoint + '/' + id,
    async (route) => {
      bodyStarted();
      await holdBody;
      await route.fulfill({ status: 503, json: unavailable() });
    },
    { times: 1 },
  );
  await panel.getByRole('button', { name: '查看管理员通知正文', exact: true }).click();
  try {
    await startingBody;
    await expect(panel.getByLabel('正在读取管理员通知正文', { exact: true })).toBeVisible();
  } finally {
    releaseBody();
  }
  const noticeContent = panel.getByRole('region', { name: '管理员通知正文', exact: true });
  await expect(
    noticeContent.getByRole('button', { name: '重试读取通知正文', exact: true }),
  ).toBeVisible();
  await expect(noticeContent.getByText(originalText, { exact: true })).toHaveCount(0);
  await noticeContent.getByRole('button', { name: '重试读取通知正文', exact: true }).click();
  await expect(noticeContent.getByText(originalText, { exact: true })).toBeVisible();
  expect(bodyReads).toHaveLength(2);
  expect(bindings).toHaveLength(0);
  await panel.getByRole('button', { name: '收起管理员通知正文', exact: true }).click();
  await expect(noticeContent).toBeHidden();
  let postReadFailures = 0;
  await page.route(
    '**' + detailPath(id),
    (route) => {
      postReadFailures++;
      return route.fulfill({ status: 503, json: unavailable() });
    },
    { times: 1 },
  );
  await confirm(page);
  await expect(panel.getByRole('region', { name: '原重投请求', exact: true })).toContainText(
    '重投结果尚不确定',
  );
  await expect(
    panel.getByText('暂时无法读取当前结果，原请求仍可单独核对', { exact: true }),
  ).toBeVisible();
  expect(postReadFailures).toBe(1);
  await expect(panel.getByText('本轮投递失败', { exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: '核对当前投递状态', exact: true }).click();
  await expect(panel.getByText('修订 2', { exact: true })).toBeVisible();
  await expect(panel.getByText('本轮投递失败', { exact: true })).toHaveCount(0);
  await expect(panel.getByText('隔离浏览器：本次应答无法确认', { exact: true })).toBeVisible();
  const receiptRead = page.waitForRequest(
    (request) =>
      request.method() === 'GET' &&
      new URL(request.url()).pathname === detailPath(id) + '/retry-receipt',
  );
  await panel.getByRole('button', { name: '核对原请求', exact: true }).click();
  expect((await receiptRead).headers()['idempotency-key']).toBe(bindings[0]?.key);
  await expect(panel.getByRole('region', { name: '原重投请求', exact: true })).toContainText(
    '原请求曾被受理',
  );
  await expect(panel.getByText('隔离浏览器：本次应答无法确认', { exact: true })).toHaveCount(0);
  await expect(panel.getByText('请再试一次', { exact: true })).toHaveCount(0);
  await expect(panel.getByRole('region', { name: '原重投请求', exact: true })).toContainText(
    /\d{2}:\d{2}:\d{2}/,
  );
  await expect(panel.getByRole('region', { name: '原重投请求', exact: true })).toContainText(
    '北京时间',
  );
  await expect(panel.getByText('修订 2', { exact: true })).toBeVisible();
  expect(bindings).toHaveLength(1);
  await panel.getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('[data-delivery-id="' + id + '"]').click();
  await expect(panel.getByRole('region', { name: '原重投请求', exact: true })).toContainText(
    '原请求基于修订 1',
  );
  expect(bindings).toHaveLength(1);
  await panel.getByRole('button', { name: '关闭', exact: true }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await selectAccountNavigation(page, '失败任务');
  await expect(page).toHaveURL(/\/admin\/tasks$/);
  await page.goBack();
  await expect(page).toHaveURL(/custom=preserved$/);
  expect(await page.evaluate(() => Reflect.get(window, 'notificationRetrySpaContext'))).toBe(true);
  await page.locator('[data-delivery-id="' + id + '"]').click();
  await expect(panel.getByRole('region', { name: '原重投请求', exact: true })).toContainText(
    '原请求基于修订 1',
  );
  await page.route(
    '**' + detailPath(id) + '/retry-receipt?*',
    (route) =>
      route.fulfill({
        status: 429,
        json: {
          error: {
            code: 'RATE_LIMITED',
            message: '隔离只读核对限流',
            fieldErrors: [],
            requestId: randomUUID(),
          },
        },
      }),
    { times: 1 },
  );
  await panel.getByRole('button', { name: '核对原请求', exact: true }).click();
  await expect(
    panel.getByText('原请求暂时无法核对，原标识与载荷仍保留，请稍后明确核对', { exact: true }),
  ).toBeVisible();
  await panel.getByRole('button', { name: '核对原请求', exact: true }).click();
  await expect(panel.getByRole('region', { name: '原重投请求', exact: true })).toContainText(
    '原请求曾被受理',
  );
  expect(bindings).toHaveLength(1);
  await assertOneRound(owned, id);
  await panel.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('tab', { name: '写通知', exact: true }).click();
  await expect(page.getByLabel('通知标题', { exact: true })).toHaveValue('未提交的独立通知标题');
  await expect(page.getByLabel('通知内容', { exact: true })).toHaveValue(
    '切换精确详情后仍需保留的输入',
  );
});

test('无回执的浏览器未知分支仅由用户明确重试同key同载荷，正常Worker最终跳过不可用目标', async ({
  page,
  owned,
}) => {
  const id = await failed(owned, 'profile_state');
  const sent: { key: string | undefined; body: unknown }[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      request.url().endsWith(endpoint + '/failures/' + id + '/retry')
    )
      sent.push({ key: request.headers()['idempotency-key'], body: request.postDataJSON() });
  });
  await page.route(
    '**' + endpoint + '/failures/' + id + '/retry',
    (route) => route.fulfill({ status: 503, json: unavailable() }),
    { times: 1 },
  );
  const panel = await open(page, id, '&failuresPage=1&status=all');
  await confirm(page);
  await panel.getByRole('button', { name: '核对原请求', exact: true }).click();
  await expect(panel.getByRole('region', { name: '原重投请求', exact: true })).toContainText(
    '本次核对未找到该原请求回执',
  );
  expect(sent).toHaveLength(1);
  await panel.getByRole('button', { name: '返回失败任务', exact: true }).click();
  const failures = page.getByRole('dialog', { name: '业务通知失败任务', exact: true });
  await expect(failures.locator('[data-delivery-id="' + id + '"]')).toBeFocused();
  await failures.locator('[data-delivery-id="' + id + '"]').click();
  await expect(panel.getByRole('heading', { name: '通知投递详情', exact: true })).toBeFocused();
  await panel.getByRole('button', { name: '明确重试原请求', exact: true }).click();
  await expect(panel.getByRole('region', { name: '原重投请求', exact: true })).toContainText(
    '重投请求已受理',
  );
  await expect(panel.getByRole('button', { name: '核对当前投递状态', exact: true })).toBeFocused();
  expect(sent).toHaveLength(2);
  expect(sent[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
  expect(sent[1]).toEqual(sent[0]);
  await expect.poll(async () => (await current(page, id)).status).toBe('skipped');
  await panel.getByRole('button', { name: '核对当前投递状态', exact: true }).click();
  await expect(panel.getByText('已跳过投递', { exact: true })).toBeVisible();
  await expect(panel.getByText('已送达站内通知', { exact: true })).toHaveCount(0);
  await assertOneRound(owned, id);
});

test('敏感通知原地确认密码后不自动重发，明确重试仍使用原key与修订', async ({ page, owned }) => {
  const id = await failed(owned, 'account_security');
  await expireSystemCredential(owned.account.username, 'password');
  const sent: { key: string | undefined; body: unknown }[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      request.url().endsWith(endpoint + '/failures/' + id + '/retry')
    )
      sent.push({ key: request.headers()['idempotency-key'], body: request.postDataJSON() });
  });
  const panel = await open(page, id);
  await confirm(page);
  await panel.getByRole('button', { name: '验证高危操作', exact: true }).click();
  const verify = page.getByRole('dialog', { name: '验证高危操作', exact: true });
  await verify.getByLabel('当前登录密码', { exact: true }).fill(owned.account.password);
  await verify.getByRole('button', { name: '确认身份', exact: true }).click();
  await expect(verify).toBeHidden();
  await expect(panel).toContainText('身份已确认，表单内容已保留，请重试刚才的操作');
  expect(sent).toHaveLength(1);
  await panel.getByRole('button', { name: '明确重试原请求', exact: true }).click();
  await expect(panel.getByRole('region', { name: '原重投请求', exact: true })).toContainText(
    '重投请求已受理',
  );
  expect(sent).toHaveLength(2);
  expect(sent[1]).toEqual(sent[0]);
  await expect.poll(async () => (await current(page, id)).status).toBe('delivered');
  await assertOneRound(owned, id);
});

test('其他请求已受理后旧修订412，原请求可只读核对且当前结果不被旧反馈覆盖', async ({
  page,
  owned,
}) => {
  const id = await failed(owned),
    panel = await open(page, id);
  await panel.getByRole('button', { name: '重试投递', exact: true }).click();
  expect(
    (
      await browserWrite(
        page,
        endpoint + '/' + id + '/retry',
        { expectedRevision: 1, confirmed: true },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status(),
  ).toBe(200);
  const response = page.waitForResponse(
    (result) =>
      result.url().endsWith(endpoint + '/' + id + '/retry') && result.request().method() === 'POST',
  );
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '确认重投', exact: true })
    .click();
  expect((await response).status()).toBe(412);
  await expect(panel.getByRole('region', { name: '原重投请求', exact: true })).toContainText(
    '原请求基于修订 1',
  );
  await panel.getByRole('button', { name: '核对原请求', exact: true }).click();
  await expect(panel.getByRole('region', { name: '原重投请求', exact: true })).toContainText(
    '本次核对未找到该原请求回执',
  );
  await expect.poll(async () => (await current(page, id)).status).toBe('delivered');
  await panel.getByRole('button', { name: '核对当前投递状态', exact: true }).click();
  await expect(panel.getByText('修订 2', { exact: true })).toBeVisible();
  await expect(panel.getByText('已送达站内通知', { exact: true })).toBeVisible();
  await assertOneRound(owned, id);
});

test('显式退出再同账号登录后迟到的真实POST回调不能恢复已清除的私有原请求', async ({
  page,
  owned,
}) => {
  const id = await failed(owned);
  let release = () => {},
    accepted = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const received = new Promise<void>((resolve) => {
    accepted = resolve;
  });
  await page.route(
    '**' + endpoint + '/' + id + '/retry',
    async (route) => {
      const result = await route.fetch();
      expect(result.status()).toBe(200);
      accepted();
      await held;
      await route.fulfill({ response: result });
    },
    { times: 1 },
  );
  const other = await page.context().newPage();
  try {
    await open(page, id);
    await page.evaluate(() => Reflect.set(window, 'notificationRetryLogoutContext', true));
    await confirm(page);
    await received;
    await other.goto('/account');
    await logoutAccount(other);
    await expect(page.getByRole('dialog', { name: '通知投递详情', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '打开账号菜单', exact: true })).toHaveCount(0);
    await loginSystemUser(other, owned.account.username, owned.account.password);
    await expect(page.getByRole('button', { name: '打开账号菜单', exact: true })).toBeVisible();
    release();
    await selectAccountNavigation(page, '通知管理');
    expect(await page.evaluate(() => Reflect.get(window, 'notificationRetryLogoutContext'))).toBe(
      true,
    );
    await page.locator('[data-delivery-id="' + id + '"]').click();
    const panel = page.getByRole('dialog', { name: '通知投递详情', exact: true });
    await expect(panel).toContainText(owned.receiver.username);
    await expect(panel.getByRole('region', { name: '原重投请求', exact: true })).toHaveCount(0);
    await assertOneRound(owned, id);
  } finally {
    release();
    await other.close();
  }
});

test('已主动绑定MFA的敏感重投仅用动态验证分支，完成后仍需明确重试原标识', async ({
  page,
  owned,
}) => {
  const id = await failed(owned, 'account_security');
  const administrator = await loginBrowserAdmin(page);
  await expireSystemCredential(administrator.username, 'mfa');
  const sent: { key: string | undefined; body: unknown }[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      request.url().endsWith(endpoint + '/failures/' + id + '/retry')
    )
      sent.push({ key: request.headers()['idempotency-key'], body: request.postDataJSON() });
  });
  const panel = await open(page, id);
  await confirm(page);
  await panel.getByRole('button', { name: '验证高危操作', exact: true }).click();
  const verify = page.getByRole('dialog', { name: '验证高危操作', exact: true });
  await expect(verify.getByLabel('当前登录密码', { exact: true })).toHaveCount(0);
  await verify.getByLabel('动态验证码或恢复码', { exact: true }).fill(administrator.recoveryCode);
  await verify.getByRole('button', { name: '确认身份', exact: true }).click();
  await expect(verify).toBeHidden();
  await expect(panel).toContainText('身份已确认，表单内容已保留，请重试刚才的操作');
  expect(sent).toHaveLength(1);
  await panel.getByRole('button', { name: '明确重试原请求', exact: true }).click();
  await expect(panel.getByRole('region', { name: '原重投请求', exact: true })).toContainText(
    '重投请求已受理',
  );
  expect(sent).toHaveLength(2);
  expect(sent[1]).toEqual(sent[0]);
  await expect.poll(async () => (await current(page, id)).status).toBe('delivered');
  await assertOneRound(owned, id);
});

test('管理员角色实际撤销后，迟到的已受理响应不能恢复私有详情与管理员操作', async ({
  page,
  owned,
  browser,
}) => {
  const id = await failed(owned);
  let release = () => {},
    accepted = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const received = new Promise<void>((resolve) => {
    accepted = resolve;
  });
  await page.route(
    '**' + endpoint + '/' + id + '/retry',
    async (route) => {
      const result = await route.fetch();
      expect(result.status()).toBe(200);
      accepted();
      await held;
      await route.fulfill({ response: result });
    },
    { times: 1 },
  );
  const password = 'Owned role reviewer passphrase 2026';
  const manager = await createAdministrator(owned.database, {
    username: 'notify_manager_' + randomUUID().replaceAll('-', '').slice(0, 10),
    email: randomUUID() + '@fixture.invalid',
    password,
  });
  const context = await browser.newContext({
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
  });
  try {
    const other = await context.newPage();
    await loginSystemUser(other, manager.username, password);
    await open(page, id);
    await confirm(page);
    await received;
    const target = AdminUserResponseSchema.parse(
      await (await other.request.get('/api/v1/admin/users/' + owned.account.id)).json(),
    ).data;
    expect(
      (
        await browserWrite(
          other,
          '/api/v1/admin/users/' + owned.account.id + '/role',
          {
            role: 'user',
            expectedSecurityVersion: target.securityVersion,
            reason: '隔离正常权限边界：撤销本轮处理者的管理员角色',
          },
          'PUT',
          { 'Idempotency-Key': randomUUID() },
        )
      ).status(),
    ).toBe(200);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('dialog', { name: '通知投递详情', exact: true })).toHaveCount(0);
    release();
    await expect(page.getByRole('button', { name: '重试投递', exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: '原重投请求', exact: true })).toHaveCount(0);
    expect((await page.request.get(detailPath(id))).status()).toBe(401);
    await assertOneRound(owned, id);
  } finally {
    release();
    await context.close();
  }
});

test('未登录和普通角色不能读精确私有元数据，无效定位与真实404都有可达恢复入口', async ({
  page,
  owned,
  browser,
}) => {
  const id = await failed(owned);
  const anonymous = await browser.newContext({
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
  });
  try {
    expect((await anonymous.request.get(detailPath(id))).status()).toBe(401);
  } finally {
    await anonymous.close();
  }
  expect((await owned.receiverPage.request.get(detailPath(id))).status()).toBe(403);
  await owned.receiverPage.goto('/admin/notifications?deliveryId=' + id);
  await expect(owned.receiverPage.getByText('你没有通知管理权限', { exact: true })).toBeVisible();
  await expect(
    owned.receiverPage.getByRole('dialog', { name: '通知投递详情', exact: true }),
  ).toHaveCount(0);
  await page.goto('/admin/notifications?deliveryId=invalid&status=all&custom=preserved');
  let panel = page.getByRole('dialog', { name: '通知投递详情', exact: true });
  await expect(panel).toContainText('通知定位参数无效');
  await panel.getByRole('button', { name: '移除无效定位', exact: true }).click();
  await expect(page).toHaveURL(/status=all&custom=preserved$/);
  await expect(page.getByRole('link', { name: '查看业务通知失败任务', exact: true })).toBeFocused();
  await page.goto(
    '/admin/notifications?deliveryId=' + randomUUID() + '&status=all&custom=preserved',
  );
  panel = page.getByRole('dialog', { name: '通知投递详情', exact: true });
  await expect(panel).toContainText('通知任务不存在或不可访问');
  await expect(
    panel.getByText('暂时无法读取当前结果，原请求仍可单独核对', { exact: true }),
  ).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '核对原请求', exact: true })).toHaveCount(0);
  await expect(
    panel.getByText('当前没有此对象的原请求；请关闭详情后重新选择真实记录', { exact: true }),
  ).toBeVisible();
  await panel.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page).toHaveURL(/status=all&custom=preserved$/);
  expect(
    AuthContextResponseSchema.parse(await (await page.request.get('/api/v1/auth/context')).json())
      .data.account?.id,
  ).toBe(owned.account.id);
});

test('通知管理标题涵盖记录和发送，两条短记录保持阅读宽度且切分区保留输入', async ({
  page,
  owned,
}) => {
  for (const title of ['自有短记录甲', '自有短记录乙']) {
    expect(
      (
        await browserWrite(
          page,
          endpoint,
          { recipientId: owned.receiver.id, title, message: '自有短记录核对说明', confirmed: true },
          'POST',
          { 'Idempotency-Key': randomUUID() },
        )
      ).status(),
    ).toBe(200);
  }
  await page.goto('/admin/notifications?status=all&recipientId=' + owned.receiver.id);
  await expect(
    page.getByRole('heading', { level: 1, name: '站内通知管理', exact: true }),
  ).toBeVisible();
  const records = page.getByRole('region', { name: '通知投递记录', exact: true });
  await expect(records.getByRole('listitem')).toHaveCount(2);
  const bounds = await records.boundingBox();
  expect(bounds?.width).toBeLessThanOrEqual(1024);
  await page.getByRole('tab', { name: '写通知', exact: true }).click();
  await page.getByLabel('通知标题', { exact: true }).fill('保留未提交标题');
  await page.getByLabel('通知内容', { exact: true }).fill('记录分区切换后仍保留');
  await page.getByRole('tab', { name: '投递记录', exact: true }).click();
  await expect(records).toBeVisible();
  await page.getByRole('tab', { name: '写通知', exact: true }).click();
  await expect(page.getByLabel('通知标题', { exact: true })).toHaveValue('保留未提交标题');
  await expect(page.getByLabel('通知内容', { exact: true })).toHaveValue('记录分区切换后仍保留');
});

test('自然会话过期后隐藏私有详情，同账号重新登录只恢复待核对草稿而不自动重投', async ({
  page,
  owned,
}) => {
  const id = await failed(owned);
  const sent: { key: string | undefined; body: unknown }[] = [];
  const privateGets: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path === endpoint + '/' + id + '/retry')
      sent.push({ key: request.headers()['idempotency-key'], body: request.postDataJSON() });
    if (request.method() === 'GET' && path.startsWith(endpoint)) privateGets.push(path);
  });
  await page.route(
    '**' + endpoint + '/' + id + '/retry',
    async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.fulfill({ status: 503, json: unavailable() });
    },
    { times: 1 },
  );
  const panel = await open(page, id);
  await confirm(page);
  await expect(panel.getByRole('region', { name: '原重投请求', exact: true })).toContainText(
    '重投结果尚不确定',
  );
  await expect(panel.getByText('修订 2', { exact: true })).toBeVisible();
  expect(sent).toHaveLength(1);
  const original = sent[0];
  expect(original?.key).toMatch(/^[0-9a-f-]{36}$/);
  // 仅自有会话的正常到期夹具，同时保留expires_at>created_at，不依赖测试已耗时。
  await owned.database.pool.query(
    "UPDATE auth_sessions SET created_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",
    [owned.account.id],
  );
  const expired = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === '/api/v1/auth/context',
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const expiredResponse = await expired;
  expect(expiredResponse.status()).toBe(200);
  const anonymous = AuthContextResponseSchema.parse(await expiredResponse.json());
  expect(anonymous.data.account).toBeNull();
  await expect(page.getByText('请先登录', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '通知投递详情', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '原重投请求', exact: true })).toHaveCount(0);
  expect((await page.request.get(detailPath(id))).status()).toBe(401);
  const readsWhileAnonymous = privateGets.length;
  const again = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === '/api/v1/auth/context',
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect(AuthContextResponseSchema.parse(await (await again).json()).data.account).toBeNull();
  await expect(page.getByText('请先登录', { exact: true })).toBeVisible();
  expect(privateGets).toHaveLength(readsWhileAnonymous);
  const other = await page.context().newPage();
  try {
    await loginSystemUser(other, owned.account.username, owned.account.password);
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('region', { name: '原重投请求', exact: true })).toContainText(
      '原请求基于修订 1',
    );
    expect(sent).toHaveLength(1);
    const receipt = page.waitForRequest(
      (request) =>
        request.method() === 'GET' &&
        new URL(request.url()).pathname === detailPath(id) + '/retry-receipt',
    );
    await panel.getByRole('button', { name: '核对原请求', exact: true }).click();
    const actual = await receipt;
    expect(actual.headers()['idempotency-key']).toBe(original?.key);
    expect(new URL(actual.url()).searchParams.get('expectedRevision')).toBe('1');
    await expect(panel.getByRole('region', { name: '原重投请求', exact: true })).toContainText(
      '原请求曾被受理',
    );
    expect(sent).toHaveLength(1);
    await assertOneRound(owned, id);
  } finally {
    await other.close();
  }
});
