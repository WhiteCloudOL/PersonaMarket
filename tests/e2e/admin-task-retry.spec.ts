import { randomUUID } from 'node:crypto';
import { resolve, relative, isAbsolute } from 'node:path';
import { test, expect, type BrowserContext, type Page, type Request } from '@playwright/test';
import {
  AssetJobResponseSchema,
  AuthContextResponseSchema,
  AdminTaskListResponseSchema,
  AdminTaskRetryResponseSchema,
} from '@personamarket/contracts';
import { createDatabase } from '@personamarket/database';
import { LocalStorage, storeImage, createAdministrator } from '@personamarket/server';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { browserWrite, loginCreator } from '../fixtures/browser-account.js';
import { fixturePng } from '../fixtures/image.js';

test.use({ trace: 'off', screenshot: 'off' });
let context: BrowserContext,
  admin: Page,
  touch: boolean,
  credentials: Awaited<ReturnType<typeof loginBrowserAdmin>>;
const keys: string[] = [];
function browserOrigin() {
  const origin = process.env['PLAYWRIGHT_ORIGIN'];
  if (!origin) throw Error('缺少隔离浏览器站点');
  return origin;
}
function database() {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url || !new URL(url).pathname.endsWith('_test')) throw Error('只接受隔离数据库');
  return createDatabase(url);
}
function storage() {
  const path = process.env['E2E_STORAGE_ROOT'];
  if (!path) throw Error('缺少隔离素材目录');
  const local = relative(resolve('data/tests'), resolve(path));
  if (!local || local.startsWith('..') || isAbsolute(local)) throw Error('素材目录越界');
  return new LocalStorage(path);
}
test.beforeAll(async ({ browser }, info) => {
  touch = info.project.name === 'mobile';
  context = await browser.newContext({
    baseURL: browserOrigin(),
    viewport: touch
      ? { width: 390, height: 844 }
      : info.project.name === 'tablet'
        ? { width: 768, height: 1024 }
        : { width: 1440, height: 900 },
    isMobile: touch,
    hasTouch: touch,
    reducedMotion: 'reduce',
  });
  admin = await context.newPage();
  credentials = await loginBrowserAdmin(admin);
});
test.afterAll(async () => {
  try {
    for (const key of keys) await storage().delete(key);
  } finally {
    await context?.close();
  }
});
async function activate(page: Page, name: string) {
  const button = page.getByRole('button', { name, exact: true });
  if (touch) await button.tap();
  else {
    await button.focus();
    await page.keyboard.press('Enter');
  }
}
async function failedImage(page = admin, resumable = false) {
  const response = await browserWrite(page, '/api/v1/me/assets/import-url', {
    url: 'https://localhost/task-retry-' + randomUUID() + '.png',
  });
  expect(response.status()).toBe(200);
  const id = AssetJobResponseSchema.parse(await response.json()).data.id;
  await expect
    .poll(
      async () =>
        AssetJobResponseSchema.parse(
          await (await page.request.get('/api/v1/me/asset-jobs/' + id)).json(),
        ).data.status,
    )
    .toBe('failed');
  if (resumable) {
    const account = AuthContextResponseSchema.parse(
      await (await page.request.get('/api/v1/auth/context')).json(),
    ).data.account;
    if (!account) throw Error('缺少测试账号');
    const db = database();
    try {
      const asset = await storeImage(
        db,
        storage(),
        account.id,
        'content',
        fixturePng,
        undefined,
        id,
      );
      keys.push(asset.storageKey);
    } finally {
      await db.close();
    }
  }
  await page.goto('/admin/tasks?category=images');
  const trigger = page.getByRole('button', { name: '查看在线图片导入详情', exact: true }).first();
  if (touch) await trigger.tap();
  else {
    await trigger.focus();
    await page.keyboard.press('Enter');
  }
  const dialog = page.getByRole('dialog', { name: '在线图片导入', exact: true });
  await expect(dialog).toBeVisible();
  return { id, dialog, trigger };
}
async function fill(page: Page, reason: string) {
  await page.getByLabel('处理原因', { exact: true }).fill(reason);
  await page.getByRole('checkbox', { name: '我已核对原任务，确认重新处理', exact: true }).check();
}
async function ready(page: Page, id: string) {
  await expect
    .poll(
      async () =>
        AssetJobResponseSchema.parse(
          await (await page.request.get('/api/v1/me/asset-jobs/' + id)).json(),
        ).data.status,
    )
    .toBe('ready');
}

test('重试面板按需读取记录，确认校验和关闭重开保留输入，未提交不产生写入', async () => {
  const { id, dialog, trigger } = await failedImage();
  await expect(dialog.getByRole('button', { name: '创建重试请求', exact: true })).toBeVisible();
  await expect(dialog.getByText('IMAGE_IMPORT_FAILED', { exact: true })).not.toBeVisible();
  await activate(admin, '创建重试请求');
  await expect(dialog.getByLabel('处理原因', { exact: true })).toBeFocused();
  await fill(admin, '先保留输入，再核对来源后处理');
  await dialog.getByRole('button', { name: '任务信息', exact: true }).click();
  await expect(dialog.getByText(id, { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  if (touch) await trigger.tap();
  else await trigger.click();
  await expect(dialog.getByLabel('处理原因', { exact: true })).toHaveValue(
    '先保留输入，再核对来源后处理',
  );
  await expect(
    dialog.getByRole('checkbox', { name: '我已核对原任务，确认重新处理', exact: true }),
  ).toBeChecked();
  const db = database();
  try {
    expect(
      (
        await db.pool.query(
          'SELECT count(*)::int AS total FROM admin_task_retries WHERE task_id=$1',
          [id],
        )
      ).rows,
    ).toEqual([{ total: 0 }]);
  } finally {
    await db.close();
  }
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
});
test('MFA过期时原地验证保留原因和确认，不自动重发，真实Worker恢复同一素材', async () => {
  const { id, dialog } = await failedImage(admin, true),
    reason = '已核对现有私有素材，恢复中断后的任务';
  const account = AuthContextResponseSchema.parse(
    await (await admin.request.get('/api/v1/auth/context')).json(),
  ).data.account;
  if (!account) throw Error('缺少账号');
  const db = database();
  try {
    await db.pool.query(
      "UPDATE auth_sessions SET mfa_verified_at=now()-interval '11 minutes' WHERE user_id=$1 AND revoked_at IS NULL",
      [account.id],
    );
  } finally {
    await db.close();
  }
  await fill(admin, reason);
  const rejected = admin.waitForResponse(
    (response) =>
      response.url().endsWith('/' + id + '/retry') && response.request().method() === 'POST',
  );
  await activate(admin, '创建重试请求');
  expect((await rejected).status()).toBe(403);
  await activate(admin, '验证高危操作');
  const verification = admin.getByRole('dialog', { name: '验证高危操作', exact: true });
  await verification.getByLabel('动态验证码或恢复码').fill(credentials.recoveryCode);
  await verification.getByRole('button', { name: '确认身份', exact: true }).click();
  await expect(verification).toBeHidden();
  await expect(dialog.getByLabel('处理原因', { exact: true })).toHaveValue(reason);
  await expect(
    dialog.getByRole('checkbox', { name: '我已核对原任务，确认重新处理', exact: true }),
  ).toBeChecked();
  const before = database();
  try {
    expect(
      (
        await before.pool.query(
          'SELECT count(*)::int AS total FROM admin_task_retries WHERE task_id=$1',
          [id],
        )
      ).rows,
    ).toEqual([{ total: 0 }]);
  } finally {
    await before.close();
  }
  const accepted = admin.waitForResponse(
    (response) =>
      response.url().endsWith('/' + id + '/retry') && response.request().method() === 'POST',
  );
  await activate(admin, '创建重试请求');
  expect((await accepted).status()).toBe(200);
  await ready(admin, id);
  await expect(dialog.getByText('已创建重试请求', { exact: true })).toBeVisible();
  await dialog.getByRole('tab', { name: '操作记录', exact: true }).click();
  await expect(dialog.getByText(reason, { exact: true })).toBeVisible();
  await dialog.getByRole('tab', { name: '处理任务', exact: true }).click();
  await activate(admin, '关闭并刷新列表');
  await expect(dialog).toBeHidden();
  await expect(admin.getByRole('button', { name: '刷新列表', exact: true })).toBeFocused();
});
test('最后一次重试已接受但浏览器丢失响应时，达到上限仍可核对原请求，审计不重复', async () => {
  const { id, dialog } = await failedImage(admin, true),
    reason = '核对响应中断后的原请求，保持同一操作';
  const endpoint = '/api/v1/admin/tasks/image/' + id + '/retry',
    sent: Array<{ key: string | undefined; body: string | null }> = [];
  const fixture = database();
  try {
    const account = AuthContextResponseSchema.parse(
      await (await admin.request.get('/api/v1/auth/context')).json(),
    ).data.account;
    if (!account) throw Error('缺少自有账号');
    for (const attempt of [1, 2])
      await fixture.pool.query(
        "INSERT INTO admin_task_retries(source,task_id,event_id,actor_id,attempt,expected_version,reason,created_at) VALUES('image',$1,$2,$3,$4,$5,'自有历史人工重试边界夹具',now()-interval '2 minutes')",
        [id, randomUUID(), account.id, attempt, String(attempt).repeat(64)],
      );
  } finally {
    await fixture.close();
  }
  await activate(admin, '刷新处理记录');
  const listener = (request: Request) => {
    if (request.url().endsWith(endpoint) && request.method() === 'POST')
      sent.push({ key: request.headers()['idempotency-key'], body: request.postData() });
  };
  admin.on('request', listener);
  try {
    await admin.route(
      '**' + endpoint,
      async (route) => {
        await route.fetch();
        await route.abort();
      },
      { times: 1 },
    );
    await fill(admin, reason);
    await activate(admin, '创建重试请求');
    await expect(dialog.getByText('上次请求结果尚未确认', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('处理原因', { exact: true })).toBeDisabled();
    await activate(admin, '核对上次请求');
    await expect(dialog.getByText('已创建重试请求', { exact: true })).toBeVisible();
    expect(sent).toHaveLength(2);
    expect(sent[0]?.key).toBeTruthy();
    expect(sent[1]).toEqual(sent[0]);
    const db = database();
    try {
      expect(
        (
          await db.pool.query(
            'SELECT count(*)::int AS total FROM admin_task_retries WHERE task_id=$1',
            [id],
          )
        ).rows,
      ).toEqual([{ total: 3 }]);
    } finally {
      await db.close();
    }
    await ready(admin, id);
    await activate(admin, '关闭并刷新列表');
  } finally {
    admin.off('request', listener);
    await admin.unroute('**' + endpoint);
  }
});
test('版本冲突后读取单任务最新状态，保留原因并要求重新确认', async () => {
  const { id, dialog } = await failedImage(),
    reason = '保留原处理原因，重新核对版本变化';
  await fill(admin, reason);
  const state = AdminTaskListResponseSchema.parse(
    await (await admin.request.get('/api/v1/admin/tasks?category=images')).json(),
  ).data.find((task) => task.id === id);
  if (!state) throw Error('缺少失败任务');
  const external = await browserWrite(
    admin,
    '/api/v1/admin/tasks/image/' + id + '/retry',
    { expectedVersion: state.version, reason: '另一处已核对并创建请求', confirmed: true },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(external.status()).toBe(200);
  AdminTaskRetryResponseSchema.parse(await external.json());
  await expect
    .poll(
      async () =>
        AssetJobResponseSchema.parse(
          await (await admin.request.get('/api/v1/me/asset-jobs/' + id)).json(),
        ).data.status,
    )
    .toBe('failed');
  const rejected = admin.waitForResponse(
    (response) =>
      response.url().endsWith('/' + id + '/retry') && response.request().method() === 'POST',
  );
  await activate(admin, '创建重试请求');
  expect((await rejected).status()).toBe(412);
  await activate(admin, '重新核对任务');
  await expect(dialog.getByText('已读取最新任务，请重新核对后确认', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('处理原因', { exact: true })).toHaveValue(reason);
  await expect(
    dialog.getByRole('checkbox', { name: '我已核对原任务，确认重新处理', exact: true }),
  ).not.toBeChecked();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
});
test('记录读取失败不推算零次，恢复后使用真实记录，审计和单任务API保持角色隔离', async ({
  browser,
}) => {
  const image = await failedImage();
  await expect(
    image.dialog.getByRole('button', { name: '创建重试请求', exact: true }),
  ).toBeVisible();
  const path = '/api/v1/admin/tasks/image/' + image.id;
  await admin.route('**' + path + '/retries', (route) => route.abort(), { times: 1 });
  // 显式重新读取，确保本次网络错误覆盖已缓存的先前结果
  await activate(admin, '刷新处理记录');
  await expect(image.dialog.getByText('人工处理记录读取未完成', { exact: true })).toBeVisible();
  await expect(image.dialog.getByRole('button', { name: '创建重试请求', exact: true })).toHaveCount(
    0,
  );
  await activate(admin, '重新读取记录');
  await expect(
    image.dialog.getByRole('button', { name: '创建重试请求', exact: true }),
  ).toBeVisible();
  await image.dialog.getByRole('button', { name: '关闭', exact: true }).click();
  const ordinary = await browser.newContext({ baseURL: browserOrigin() });
  try {
    expect((await ordinary.request.get(path + '/retries')).status()).toBe(401);
    expect((await ordinary.request.get(path)).status()).toBe(401);
    const page = await ordinary.newPage(),
      user = await loginCreator(page);
    expect((await ordinary.request.get(path + '/retries')).status()).toBe(403);
    expect((await ordinary.request.get(path)).status()).toBe(403);
    const db = database();
    try {
      await db.pool.query("UPDATE users SET role='moderator' WHERE username=$1", [user.username]);
    } finally {
      await db.close();
    }
    expect(
      (
        await browserWrite(page, '/api/v1/auth/login', {
          identifier: user.username,
          password: user.password,
        })
      ).status(),
    ).toBe(200);
    expect((await ordinary.request.get(path + '/retries')).status()).toBe(403);
    expect((await ordinary.request.get(path)).status()).toBe(403);
  } finally {
    await ordinary.close();
    await admin.unroute('**' + path + '/retries');
  }
});

test('未绑定MFA的管理员使用当前密码原地确认，旋转会话后保留原因并完成处理', async ({ browser }) => {
  const local = await browser.newContext({
    baseURL: browserOrigin(),
    viewport: admin.viewportSize() ?? { width: 1440, height: 900 },
    isMobile: touch,
    hasTouch: touch,
  });
  const username = 'unbound_' + randomUUID().replaceAll('-', '').slice(0, 12),
    password = 'Owned browser retry passphrase 2026';
  try {
    const owner = database();
    try {
      await createAdministrator(owner, {
        username,
        password,
        email: username + '@fixture.invalid',
      });
    } finally {
      await owner.close();
    }
    const page = await local.newPage();
    await page.goto('/login');
    await page.getByLabel('用户名或邮箱').fill(username);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL(/\/account$/u);
    const { id, dialog } = await failedImage(page, true),
      reason = '未绑定MFA时使用密码确认并保留原输入';
    const account = AuthContextResponseSchema.parse(
      await (await page.request.get('/api/v1/auth/context')).json(),
    ).data.account;
    if (!account) throw Error('缺少隔离账号');
    const db = database();
    try {
      await db.pool.query(
        "UPDATE auth_sessions SET created_at=now()-interval '11 minutes' WHERE user_id=$1 AND revoked_at IS NULL",
        [account.id],
      );
    } finally {
      await db.close();
    }
    await fill(page, reason);
    const rejected = page.waitForResponse(
      (response) =>
        response.url().endsWith('/' + id + '/retry') && response.request().method() === 'POST',
    );
    await activate(page, '创建重试请求');
    const response = await rejected;
    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'REAUTH_REQUIRED' } });
    await activate(page, '验证高危操作');
    const verification = page.getByRole('dialog', { name: '验证高危操作', exact: true });
    await verification.getByLabel('当前登录密码').fill(password);
    await verification.getByRole('button', { name: '确认身份', exact: true }).click();
    await expect(verification).toBeHidden();
    await expect(dialog.getByLabel('处理原因', { exact: true })).toHaveValue(reason);
    await expect(
      dialog.getByRole('checkbox', { name: '我已核对原任务，确认重新处理', exact: true }),
    ).toBeChecked();
    const accepted = page.waitForResponse(
      (reply) => reply.url().endsWith('/' + id + '/retry') && reply.request().method() === 'POST',
    );
    await activate(page, '创建重试请求');
    expect((await accepted).status()).toBe(200);
    await ready(page, id);
    await activate(page, '关闭并刷新列表');
  } finally {
    await local.close();
  }
});
