import { randomBytes, randomUUID } from 'node:crypto';
import { test as base, expect, type Page } from '@playwright/test';
import { createDatabase, outboxEvents, rankingGenerations } from '@personamarket/database';
import { createAdministrator, createRankingRun } from '@personamarket/server';
import { RankingSettingsResponseSchema } from '@personamarket/contracts';
import { loginSystemUser } from './system-settings.js';

export const test = base.extend<{
  ownedTasks: { database: ReturnType<typeof createDatabase>; accountId: string };
}>({
  ownedTasks: async ({ page }, use) => {
    const url = process.env['TEST_DATABASE_URL'];
    if (!url || !/^\/pm_e2e_[a-f0-9]{32}_test$/.test(new URL(url).pathname))
      throw Error('精确运维E2E仅接受本轮受控隔离库');
    const database = createDatabase(url),
      password = 'Owned task browser passphrase 2026';
    try {
      const account = await createAdministrator(database, {
        username: 'task_admin_' + randomBytes(5).toString('hex'),
        email: randomUUID() + '@fixture.invalid',
        password,
      });
      await loginSystemUser(page, account.username, password);
      // 普通运维不追加recent；只调整此测试新建账号的自有会话。
      await database.pool.query(
        "UPDATE auth_sessions SET created_at=now()-interval '20 minutes',mfa_verified_at=NULL WHERE user_id=$1",
        [account.id],
      );
      await use({ database, accountId: account.id });
    } finally {
      await database.close();
    }
  },
});
test.use({ trace: 'off', screenshot: 'off' });
export { expect };
export async function ownedRanking(
  database: ReturnType<typeof createDatabase>,
  page: Page,
  algorithm: 'exports-v1' | 'interactions-v1' | 'interactions-v2' = 'interactions-v2',
) {
  const id = randomUUID(),
    eventId = randomUUID();
  const response = await page.request.get('/api/v1/admin/settings/rankings');
  expect(response.status()).toBe(200);
  const settings = RankingSettingsResponseSchema.parse(await response.json());
  await database.db.transaction(async (tx) => {
    await tx.insert(rankingGenerations).values({
      id,
      requestKey: 'owned-browser-fixture:' + id,
      algorithm,
      status: 'failed',
      attempts: 5,
      errorCode: 'RANKING_BUILD_FAILED',
      ...(algorithm === 'interactions-v2'
        ? {
            settingsRevision: settings.meta.revision,
            definition: {
              settingsRevision: settings.meta.revision,
              settings: settings.data,
              halfLifeSeconds: 604800,
            },
          }
        : {}),
    });
    await tx.insert(outboxEvents).values({
      id: eventId,
      topic: 'rankings.refresh',
      payload: { generationId: id },
      attempts: 5,
    });
    if (algorithm !== 'exports-v1') await createRankingRun(tx, id, eventId);
  });
  return id;
}
export async function ownedOperation(
  database: ReturnType<typeof createDatabase>,
  kind: 'storage' | 'mail',
) {
  const id = randomUUID();
  await database.pool.query(
    "INSERT INTO outbox_events(id,topic,payload,attempts,last_error_code) VALUES($1,$2,$3,5,'DELIVERY_FAILED')",
    [
      id,
      kind === 'storage' ? 'storage.cleanup' : 'auth.email',
      kind === 'storage'
        ? { schemaVersion: 1, storageKey: randomBytes(16).toString('hex') + '.webp' }
        : { schemaVersion: 1, encryptedMessage: 'owned-legacy-context-unavailable' },
    ],
  );
  return id;
}
export async function openExactTask(page: Page, kind: 'ranking' | 'storage' | 'mail', id: string) {
  await page.goto(
    '/admin/tasks?category=' +
      (kind === 'ranking' ? 'rankings' : kind) +
      '&custom=preserved&task=' +
      kind +
      ':' +
      id,
  );
  const panel = page.getByRole('dialog', {
    name:
      kind === 'ranking' ? '榜单生成详情' : kind === 'storage' ? '文件清理核对' : '邮件任务核对',
    exact: true,
  });
  await expect(panel.getByRole('button', { name: '核对当前任务状态', exact: true })).toBeVisible();
  return panel;
}
export async function confirmTask(page: Page, reason: string, mail = false) {
  const panel = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('button', { name: '核对当前任务状态', exact: true }) });
  await panel.getByLabel('处理原因', { exact: true }).fill(reason);
  await panel
    .getByRole('button', { name: mail ? '记录人工核对说明' : '创建受控重试', exact: true })
    .click();
  const confirmation = page.getByRole('alertdialog', {
    name: mail ? '确认记录人工核对说明' : '确认创建受控重试',
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: '确认并提交', exact: true }).click();
  await expect(confirmation).toBeHidden();
}
