import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import {
  AdminRankingGenerationResponseSchema,
  RetryAdminRankingGenerationSchema,
  canonicalJson,
} from '@personamarket/contracts';
import { browserWrite } from '../fixtures/browser-account.js';
import {
  test,
  expect,
  ownedRanking,
  openExactTask,
  confirmTask,
} from '../fixtures/task-operations.js';

const endpoint = (id: string) => '/api/v1/admin/rankings/generations/' + id;

test('真实POST未结算时SPA返回仍保留未知，原key第二次拒绝与迟到错误都不能撤回已核实回执', async ({
  page,
  ownedTasks,
}) => {
  const id = await ownedRanking(ownedTasks.database, page),
    path = endpoint(id) + '/retry';
  let release = () => {},
    received = () => {};
  const held = new Promise<void>((resolve) => {
      release = resolve;
    }),
    accepted = new Promise<void>((resolve) => {
      received = resolve;
    });
  const writes: { key: string | undefined; body: unknown }[] = [];
  let routedWrites = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === path)
      writes.push({ key: request.headers()['idempotency-key'], body: request.postDataJSON() });
  });
  await page.route('**' + path, async (route) => {
    if (++routedWrites === 2) {
      // 保持同一拦截器存活，避免首个应答等待时改写浏览器拦截规则。
      await route.fulfill({
        status: 429,
        json: {
          error: {
            code: 'RATE_LIMITED',
            message: '受控浏览器：原key重试本次明确受限',
            fieldErrors: [],
            requestId: randomUUID(),
          },
        },
      });
      return;
    }
    expect(routedWrites).toBe(1);
    const result = await route.fetch();
    expect(result.status()).toBe(200);
    received();
    await held;
    await route.fulfill({
      status: 503,
      json: {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: '受控浏览器：原已受理请求的迟到应答未知',
          fieldErrors: [],
          requestId: randomUUID(),
        },
      },
    });
  });
  try {
    await page.goto('/admin/tasks?category=rankings&custom=preserved');
    await page.locator('a[href*="task=ranking%3A' + id + '"]').click();
    const panel = page.getByRole('dialog', { name: '榜单生成详情', exact: true });
    await panel.getByLabel('处理原因', { exact: true }).fill('跨导航仍需核对这一原批次和原请求');
    await page.evaluate(() => Reflect.set(window, 'taskRetrySpaContext', true));
    await panel.getByRole('button', { name: '创建受控重试', exact: true }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: '确认并提交', exact: true })
      .click();
    await accepted;
    await page.goBack();
    await expect(page).toHaveURL(/category=rankings&custom=preserved$/);
    await page.goForward();
    await expect(panel.getByRole('region', { name: '原处理请求', exact: true })).toContainText(
      '结果尚未确认',
    );
    expect(await page.evaluate(() => Reflect.get(window, 'taskRetrySpaContext'))).toBe(true);
    // 仅浏览器第二次应答分支，原业务已经真实受理；不停止服务或制造依赖故障。
    await panel.getByRole('button', { name: '明确重试原请求', exact: true }).click();
    await expect(panel.getByRole('region', { name: '原处理请求', exact: true })).toContainText(
      '结果尚未确认',
    );
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    const receipt = page.waitForRequest(
      (request) =>
        request.method() === 'GET' &&
        new URL(request.url()).pathname === endpoint(id) + '/retry-receipt',
    );
    await panel.getByRole('button', { name: '核对原请求', exact: true }).click();
    const request = await receipt,
      input = RetryAdminRankingGenerationSchema.parse(writes[0]?.body);
    expect(request.headers()['idempotency-key']).toBe(writes[0]?.key);
    expect(request.headers()['x-retry-request-hash']).toBe(
      createHash('sha256')
        .update(canonicalJson({ id, ...input }))
        .digest('hex'),
    );
    await expect(panel.getByRole('region', { name: '原处理请求', exact: true })).toContainText(
      '原请求回执已核实为已受理',
    );
    const delayed = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === path &&
        response.status() === 503,
    );
    release();
    await (await delayed).finished();
    await panel.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(page).toHaveURL(/category=rankings&custom=preserved$/);
    await page.goBack();
    await expect(panel.getByRole('region', { name: '原处理请求', exact: true })).toContainText(
      '原请求回执已核实为已受理',
    );
    expect(writes).toHaveLength(2);
    expect(
      (
        await ownedTasks.database.pool.query(
          "SELECT count(*)::int n FROM admin_task_retries WHERE source='ranking' AND task_id=$1",
          [id],
        )
      ).rows,
    ).toEqual([{ n: 1 }]);
  } finally {
    release();
    if (!page.isClosed()) await page.unrouteAll({ behavior: 'wait' });
  }
});
test('同一冻结批次真实恢复，18/36/39板结果按实际算法核验，普通会话无需追加recent', async ({
  page,
  ownedTasks,
}) => {
  for (const [algorithm, boards] of [
    ['exports-v1', 18],
    ['interactions-v1', 36],
    ['interactions-v2', 39],
  ] as const) {
    const id = await ownedRanking(ownedTasks.database, page, algorithm),
      panel = await openExactTask(page, 'ranking', id);
    await expect(panel.getByText(algorithm, { exact: true })).toBeVisible();
    await confirmTask(page, '已核对冻结算法，恢复同一自有批次');
    await expect(
      panel.getByRole('button', { name: '核对当前任务状态', exact: true }),
    ).toBeFocused();
    await expect
      .poll(
        async () =>
          AdminRankingGenerationResponseSchema.parse(
            await (await page.request.get(endpoint(id))).json(),
          ).data.completion.state,
      )
      .toBe('verified');
    await panel.getByRole('button', { name: '核对当前任务状态', exact: true }).click();
    await expect(panel.getByText('已核验完成', { exact: true })).toBeVisible();
    await expect(
      panel.getByText('实际 ' + boards + ' / 应有 ' + boards + ' 块榜板', { exact: true }),
    ).toBeVisible();
    await panel.getByRole('button', { name: '核对原请求', exact: true }).click();
    await expect(panel.getByRole('region', { name: '原处理请求', exact: true })).toContainText(
      '原请求回执已核实为已受理',
    );
    expect(
      (
        await ownedTasks.database.pool.query(
          "SELECT count(*)::int n FROM admin_task_retries WHERE source='ranking' AND task_id=$1",
          [id],
        )
      ).rows,
    ).toEqual([{ n: 1 }]);
  }
});
test('确认取消与关闭返回不丢原因，已成功应答未知只读核对沿用原key和hash，不自动POST', async ({
  page,
  ownedTasks,
}) => {
  const id = await ownedRanking(ownedTasks.database, page),
    panel = await openExactTask(page, 'ranking', id),
    reason = '保留自有批次原因，明确核对同一个请求';
  const writes: { key: string | undefined; body: unknown }[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === endpoint(id) + '/retry')
      writes.push({ key: request.headers()['idempotency-key'], body: request.postDataJSON() });
  });
  await panel.getByLabel('处理原因', { exact: true }).fill(reason);
  await panel.getByRole('button', { name: '创建受控重试', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '返回核对', exact: true })
    .click();
  await expect(panel.getByLabel('处理原因', { exact: true })).toHaveValue(reason);
  await panel.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page).toHaveURL(/category=rankings&custom=preserved$/);
  await page.goBack();
  await expect(panel.getByLabel('处理原因', { exact: true })).toHaveValue(reason);
  await page.route(
    '**' + endpoint(id) + '/retry',
    async (route) => {
      const accepted = await route.fetch();
      expect(accepted.status()).toBe(200);
      await route.fulfill({
        status: 503,
        json: {
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: '受控浏览器仅此应答未知',
            fieldErrors: [],
            requestId: randomUUID(),
          },
        },
      });
    },
    { times: 1 },
  );
  await confirmTask(page, reason);
  await expect(panel.getByRole('region', { name: '原处理请求', exact: true })).toContainText(
    '结果尚未确认',
  );
  expect(writes).toHaveLength(1);
  const receipt = page.waitForRequest(
    (request) =>
      request.method() === 'GET' &&
      new URL(request.url()).pathname === endpoint(id) + '/retry-receipt',
  );
  await panel.getByRole('button', { name: '核对原请求', exact: true }).click();
  expect((await receipt).headers()['idempotency-key']).toBe(writes[0]?.key);
  await expect(panel.getByRole('region', { name: '原处理请求', exact: true })).toContainText(
    '原请求回执已核实为已受理',
  );
  expect(writes).toHaveLength(1);
});
test('实际版本冲突保留原因并重新核对，不能用列表旧version直接提交', async ({
  page,
  ownedTasks,
}) => {
  const id = await ownedRanking(ownedTasks.database, page),
    panel = await openExactTask(page, 'ranking', id);
  const before = AdminRankingGenerationResponseSchema.parse(
    await (await page.request.get(endpoint(id))).json(),
  ).data;
  await panel.getByLabel('处理原因', { exact: true }).fill('本页未提交的原因应在真实冲突后保持');
  await panel.getByRole('button', { name: '创建受控重试', exact: true }).click();
  expect(
    (
      await browserWrite(
        page,
        endpoint(id) + '/retry',
        {
          expectedVersion: before.version,
          reason: '另一正常请求先恢复该自有批次',
          confirmed: true,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status(),
  ).toBe(200);
  // 让另一真实请求的 Worker 完成；本场景核对版本冲突，不与计算锁竞争。
  await expect
    .poll(async () => {
      const response = await page.request.get(endpoint(id));
      expect(response.status()).toBe(200);
      return AdminRankingGenerationResponseSchema.parse(await response.json()).data.completion
        .state;
    })
    .toBe('verified');
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '确认并提交', exact: true })
    .click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await expect(panel.getByLabel('处理原因', { exact: true })).toHaveValue(
    '本页未提交的原因应在真实冲突后保持',
  );
  await expect(panel.getByRole('button', { name: '核对原请求', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '核对当前任务状态', exact: true }).click();
  expect(
    (
      await ownedTasks.database.pool.query(
        "SELECT count(*)::int n FROM admin_task_retries WHERE source='ranking' AND task_id=$1",
        [id],
      )
    ).rows,
  ).toEqual([{ n: 1 }]);
});
