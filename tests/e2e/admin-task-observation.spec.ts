import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { Queue } from 'bullmq';
import { createDatabase } from '@personamarket/database';
import { AdminTaskListResponseSchema } from '@personamarket/contracts';
import { queueConnection } from '@personamarket/server';
import { e2eQueueName } from '../../scripts/e2e-queue.js';
import { browserWrite } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';

test.use({ trace: 'off', screenshot: 'off' });
let context: BrowserContext, admin: Page, source: string, mailEventId: string, touch: boolean;
test.beforeAll(async ({ browser }, info) => {
  const url = process.env['TEST_DATABASE_URL'],
    origin = process.env['PLAYWRIGHT_ORIGIN'];
  if (!url || !/^\/pm_e2e_[a-f0-9]{32}_test$/u.test(new URL(url).pathname) || !origin)
    throw Error('只接受本轮浏览器隔离数据库和站点');
  source = url;
  touch = info.project.name === 'mobile';
  context = await browser.newContext({
    baseURL: origin,
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
  await loginBrowserAdmin(admin);
  const database = createDatabase(source),
    anonymous = await browser.newContext({ baseURL: origin });
  try {
    await expect
      .poll(async () =>
        Number(
          (
            await database.pool.query(
              "SELECT count(*) FROM outbox_events o WHERE topic='auth.email' AND NOT EXISTS(SELECT 1 FROM processed_events p WHERE p.event_id=o.id AND p.consumer='auth-email')",
            )
          ).rows[0]?.count,
        ),
      )
      .toBe(0);
    // 只在本用例隔离库注入SMTP成功后的回执故障；生产Worker照常执行并持久保护未知结果
    await database.pool.query(
      "CREATE FUNCTION fail_observation_mail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.consumer='auth-email' THEN RAISE EXCEPTION 'controlled mail receipt failure'; END IF; RETURN NEW; END; $$",
    );
    await database.pool.query(
      'CREATE TRIGGER fail_observation_mail_receipt BEFORE INSERT ON processed_events FOR EACH ROW EXECUTE FUNCTION fail_observation_mail_receipt()',
    );
    const page = await anonymous.newPage();
    const username = 'observe_' + randomUUID().replaceAll('-', '').slice(0, 12);
    const response = await browserWrite(page, '/api/v1/auth/register', {
      username,
      email: username + '@fixture.invalid',
      password: 'Mail observation fixture passphrase 2026',
    });
    expect(response.status()).toBe(200);
    await expect
      .poll(
        async () =>
          (
            await database.pool.query<{ event_id: string; status: string; attempts: number }>(
              "SELECT event_id,status,attempts FROM mail_deliveries WHERE status='uncertain'",
            )
          ).rows,
      )
      .toEqual([expect.objectContaining({ status: 'uncertain', attempts: 1 })]);
    const row = (
      await database.pool.query<{ event_id: string }>(
        "SELECT event_id FROM mail_deliveries WHERE status='uncertain'",
      )
    ).rows[0];
    if (!row) throw Error('缺少真实邮件待确认记录');
    mailEventId = row.event_id;
  } finally {
    await database.pool.query(
      'DROP TRIGGER IF EXISTS fail_observation_mail_receipt ON processed_events',
    );
    await database.pool.query('DROP FUNCTION IF EXISTS fail_observation_mail_receipt()');
    await anonymous.close();
    await database.close();
  }
});
test.afterAll(async () => {
  await context?.close();
});

test('真实SMTP回执故障在邮件列表只展示一次，详情保留真实次数和安全摘要', async () => {
  await admin.goto('/admin/tasks?category=mail');
  await expect(admin.getByRole('heading', { name: '邮件投递', exact: true })).toHaveCount(1);
  const trigger = admin.getByRole('link', { name: '查看邮件投递详情', exact: true });
  if (touch) await trigger.tap();
  else await trigger.click();
  const dialog = admin.getByRole('dialog', { name: '邮件任务核对', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('邮件发送结果未知');
  await dialog.getByRole('button', { name: '查看邮件关联与技术详情', exact: true }).click();
  await expect(dialog).toContainText(mailEventId);
  expect(await dialog.textContent()).not.toContain('@fixture.invalid');
  const response = await context.request.get('/api/v1/admin/tasks?category=mail');
  expect(response.status()).toBe(200);
  expect(AdminTaskListResponseSchema.parse(await response.json())).toMatchObject({
    data: [
      {
        source: 'mail',
        id: mailEventId,
        stage: 'uncertain',
        executionAttempts: 1,
        errorCode: 'MAIL_RECEIPT_UNCERTAIN',
      },
    ],
    meta: { total: 1 },
  });
  if (touch) await dialog.getByRole('button', { name: '关闭', exact: true }).tap();
  else await admin.keyboard.press('Escape');
  await expect(admin.getByRole('link', { name: '查看邮件投递详情', exact: true })).toBeFocused();
});

test('采样范围按需展开，保留失败数不冒充业务失败数，关闭后恢复焦点', async () => {
  await admin.goto('/admin/tasks?category=mail');
  const trigger = admin.getByRole('button', { name: '查看观测范围', exact: true });
  await expect(trigger).toBeVisible();
  if (touch) await trigger.tap();
  else {
    await trigger.focus();
    await admin.keyboard.press('Enter');
  }
  const dialog = admin.getByRole('dialog', { name: '观测范围', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('保留失败总数');
  await expect(dialog).toContainText('最多 500 条');
  await expect(dialog).toContainText('重新发送可能产生重复副作用');
  if (touch) await dialog.getByRole('button', { name: '关闭', exact: true }).tap();
  else await admin.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('真实旧队列契约异常时明确部分观测，空筛选不宣称全部任务正常', async () => {
  const redis = process.env['REDIS_URL'];
  if (!redis) throw Error('缺少隔离Redis');
  const database = createDatabase(source),
    queue = new Queue<unknown>(e2eQueueName(source), { connection: queueConnection(redis, true) }),
    eventId = randomUUID();
  queue.on('error', () => undefined);
  try {
    await database.pool.query(
      "INSERT INTO outbox_events(id,topic,payload,delivered_at) VALUES($1,'system.probe','{\"schemaVersion\":1}',now())",
      [eventId],
    );
    const job = await queue.add(
      'system.probe',
      { eventId, schemaVersion: 0 },
      { jobId: eventId, attempts: 1, removeOnFail: false },
    );
    await expect.poll(() => job.getState()).toBe('failed');
    await admin.goto('/admin/tasks?category=storage');
    await expect(admin.getByText('队列记录未完整读取', { exact: true })).toBeVisible();
    await expect(admin.getByRole('heading', { name: '已知记录 · 0', exact: true })).toBeVisible();
    await expect(admin.getByText('暂未查询到可核验的失败记录', { exact: true })).toBeVisible();
    await expect(admin.getByText('已读取最新状态', { exact: true })).toHaveCount(0);
    const response = await context.request.get('/api/v1/admin/tasks?category=storage');
    expect(response.status()).toBe(200);
    expect(AdminTaskListResponseSchema.parse(await response.json())).toMatchObject({
      data: [],
      meta: { total: 0, queueObservation: { status: 'partial', unverifiable: 1 } },
    });
  } finally {
    await queue.close();
    await database.close();
  }
});
