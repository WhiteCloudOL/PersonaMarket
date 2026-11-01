import { randomUUID } from 'node:crypto';
import { OperationalTaskDetailResponseSchema } from '@personamarket/contracts';
import {
  test,
  expect,
  ownedOperation,
  openExactTask,
  confirmTask,
} from '../fixtures/task-operations.js';

const endpoint = (kind: 'storage' | 'mail', id: string) =>
  '/api/v1/admin/operations/' + kind + '/' + id;
test('自有清理派发终态明确确认后，真实Worker持久化missing；原请求回执与结果分开', async ({
  page,
  ownedTasks,
}) => {
  const id = await ownedOperation(ownedTasks.database, 'storage'),
    panel = await openExactTask(page, 'storage', id);
  await expect(panel.getByText('等待核对清理结果', { exact: true })).toBeVisible();
  await confirmTask(page, '核对本轮随机隔离键，明确重查实际清理结果');
  await expect(panel.getByRole('button', { name: '核对当前任务状态', exact: true })).toBeFocused();
  await expect
    .poll(
      async () =>
        OperationalTaskDetailResponseSchema.parse(
          await (await page.request.get(endpoint('storage', id))).json(),
        ).data.status,
    )
    .toBe('missing');
  await panel.getByRole('button', { name: '核对当前任务状态', exact: true }).click();
  await expect(panel.getByText('目标文件已不存在', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: '创建受控重试', exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: '核对原请求', exact: true }).click();
  await expect(panel.getByRole('region', { name: '原处理请求', exact: true })).toContainText(
    '原请求回执已核实为已受理',
  );
  await panel.getByRole('button', { name: '查看人工处理记录', exact: true }).click();
  await expect(panel.getByRole('list', { name: '人工处理记录', exact: true })).toContainText(
    '核对本轮随机隔离键',
  );
  expect(
    (
      await ownedTasks.database.pool.query(
        "SELECT count(*)::int n FROM admin_task_retries WHERE source='queue' AND task_id=$1",
        [id],
      )
    ).rows,
  ).toEqual([{ n: 1 }]);
});
test('邮件旧上下文保持未知，只追加人工说明，不发新邮件、不修改SMTP结果', async ({
  page,
  ownedTasks,
}) => {
  const id = await ownedOperation(ownedTasks.database, 'mail'),
    before = (
      await ownedTasks.database.pool.query(
        "SELECT count(*)::int n FROM outbox_events WHERE topic='auth.email'",
      )
    ).rows[0]?.n;
  const panel = await openExactTask(page, 'mail', id);
  await expect(panel.getByText('旧邮件缺少业务关联', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: /重发|重试|取消邮件/ })).toHaveCount(0);
  await confirmTask(page, '已人工核对旧邮件，未知结果不再次发送', true);
  await expect(panel.getByRole('region', { name: '原处理请求', exact: true })).toContainText(
    '原请求已受理',
  );
  await panel.getByRole('button', { name: '查看人工处理记录', exact: true }).click();
  await expect(panel.getByRole('list', { name: '人工处理记录', exact: true })).toContainText(
    '已人工核对旧邮件',
  );
  expect(
    (
      await ownedTasks.database.pool.query(
        "SELECT count(*)::int n FROM outbox_events WHERE topic='auth.email'",
      )
    ).rows[0]?.n,
  ).toBe(before);
  expect(
    (
      await ownedTasks.database.pool.query(
        'SELECT count(*)::int n FROM mail_deliveries WHERE event_id=$1',
        [id],
      )
    ).rows,
  ).toEqual([{ n: 0 }]);
});
test('原storage target在业务响应稳定根id变化后仍用于同key同hash只读核对', async ({
  page,
  ownedTasks,
}) => {
  const root = await ownedOperation(ownedTasks.database, 'storage'),
    child = randomUUID(),
    key = randomUUID().replaceAll('-', '') + '.webp';
  // 正常自有谱系夹具；所有键随机且不存在，不接触任何已有素材。
  await ownedTasks.database.pool.query(
    "INSERT INTO storage_cleanup_runs(event_id,request_id,storage_key,outcome,execution_attempts,error_code,checked_at) VALUES($1,$1,$2,'failed',5,'STORAGE_CLEANUP_FAILED',clock_timestamp())",
    [root, key],
  );
  await ownedTasks.database.pool.query('UPDATE outbox_events SET payload=$2 WHERE id=$1', [
    root,
    { schemaVersion: 1, storageKey: key },
  ]);
  await ownedTasks.database.pool.query(
    "INSERT INTO outbox_events(id,topic,payload,attempts) VALUES($1,'storage.cleanup',$2,5)",
    [child, { schemaVersion: 1, storageKey: key }],
  );
  await ownedTasks.database.pool.query(
    "INSERT INTO storage_cleanup_runs(event_id,request_id,storage_key,manual_round,outcome,execution_attempts,error_code,checked_at) VALUES($1,$2,$3,1,'failed',5,'STORAGE_CLEANUP_FAILED',clock_timestamp())",
    [child, root, key],
  );
  await ownedTasks.database.pool.query(
    "INSERT INTO admin_task_retries(source,task_id,event_id,previous_event_id,actor_id,attempt,expected_version,reason,created_at) VALUES('queue',$1,$2,$1,$3,1,$4,'明确标识的自有清理历史夹具',clock_timestamp()-interval '2 minutes')",
    [root, child, ownedTasks.accountId, 'a'.repeat(64)],
  );
  const panel = await openExactTask(page, 'storage', child);
  const posts: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname.startsWith('/api/v1/admin/operations/storage/')
    )
      posts.push(new URL(request.url()).pathname);
  });
  await confirmTask(page, '按实际子事件核对稳定根清理请求');
  await panel.getByRole('button', { name: '核对原请求', exact: true }).click();
  await expect(panel.getByRole('region', { name: '原处理请求', exact: true })).toContainText(
    '原请求回执已核实为已受理',
  );
  expect(posts).toEqual([endpoint('storage', child)]);
});
