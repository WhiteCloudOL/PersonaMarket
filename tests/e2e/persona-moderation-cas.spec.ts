import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createDatabase } from '@personamarket/database';
import { AdminPersonaResponseSchema } from '@personamarket/contracts';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { browserWrite, loginCreator } from '../fixtures/browser-account.js';
import { visualPersonas } from '../fixtures/visual-personas.js';

test.use({ trace: 'off', screenshot: 'off' });

test('处置窗口冻结状态，冲突保留理由并人工刷新，会话通过校验后直接处置且恢复保留作者隐藏', async ({
  page,
  browser,
}, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  const ownerContext = await browser.newContext({
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
  });
  try {
    const owner = await ownerContext.newPage();
    await loginCreator(owner);
    const admin = await loginBrowserAdmin(page);
    const works = await visualPersonas(owner, page);
    await page.goto('/admin/moderation?submission=' + works.pendingId);
    await page.getByRole('button', { name: '封禁作品', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: '封禁作品', exact: true });
    const evidence = join('data/tests/persona-moderation-cas', info.project.name, randomUUID());
    await mkdir(evidence, { recursive: true });
    await expect(sheet.getByText('当前人设状态', { exact: true })).toBeVisible();
    await page.screenshot({ path: join(evidence, 'moderation.png') });
    const reason = sheet.getByLabel('操作理由', { exact: true });
    await reason.fill('核对状态后处理，并发冲突时保留这段理由');
    expect(
      (
        await browserWrite(owner, '/api/v1/me/personas/' + works.maibot.id + '/visibility', {
          visibility: 'hidden',
          reason: '作者在另一页隐藏',
        })
      ).status(),
    ).toBe(200);
    const path = '/api/v1/admin/personas/' + works.maibot.id + '/moderation';
    let writes = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === path) writes++;
    });
    await sheet.getByRole('button', { name: '确认封禁作品', exact: true }).click();
    await expect(
      sheet.getByText('人设状态已变化，请读取最新状态后核对', { exact: true }),
    ).toBeVisible();
    await expect(reason).toHaveValue('核对状态后处理，并发冲突时保留这段理由');
    expect(writes).toBe(1);
    await sheet.getByRole('button', { name: '读取最新状态', exact: true }).click();
    await expect(sheet.getByText('作者已隐藏', { exact: true })).toBeVisible();
    await expect(reason).toHaveValue('核对状态后处理，并发冲突时保留这段理由');
    expect(writes).toBe(1);
    const source = process.env['TEST_DATABASE_URL'];
    if (!source || !new URL(source).pathname.endsWith('_test'))
      throw new Error('必须使用隔离测试库');
    const database = createDatabase(source);
    try {
      await database.pool.query(
        "UPDATE auth_sessions SET created_at=now()-interval '20 minutes',mfa_verified_at=now()-interval '11 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
        [admin.username],
      );
    } finally {
      await database.close();
    }
    expect(
      (
        await browserWrite(owner, '/api/v1/me/personas/' + works.maibot.id + '/visibility', {
          visibility: 'listed',
          reason: '刷新以后作者改变展示选择',
        })
      ).status(),
    ).toBe(200);
    await sheet.getByRole('button', { name: '确认封禁作品', exact: true }).click();
    await expect(
      sheet.getByText('人设状态已变化，请读取最新状态后核对', { exact: true }),
    ).toBeVisible();
    expect(writes).toBe(2);
    expect(
      (
        await browserWrite(owner, '/api/v1/me/personas/' + works.maibot.id + '/visibility', {
          visibility: 'hidden',
          reason: '保留作者最终隐藏选择',
        })
      ).status(),
    ).toBe(200);
    await sheet.getByRole('button', { name: '读取最新状态', exact: true }).click();
    await expect(reason).toHaveValue('核对状态后处理，并发冲突时保留这段理由');
    await sheet.getByRole('button', { name: '确认封禁作品', exact: true }).click();
    await expect(sheet).toBeHidden();
    await page.getByRole('button', { name: '解除作品封禁', exact: true }).click();
    const restore = page.getByRole('dialog', { name: '解除作品封禁', exact: true });
    await restore.getByLabel('操作理由', { exact: true }).fill('核对后解除封禁');
    await restore.getByRole('button', { name: '确认解除作品封禁', exact: true }).click();
    await expect(restore).toBeHidden();
    await expect(page.getByRole('dialog', { name: '验证高危操作', exact: true })).toHaveCount(0);
    const state = AdminPersonaResponseSchema.parse(
      await (await page.request.get('/api/v1/admin/personas/' + works.maibot.id)).json(),
    ).data;
    expect(state).toMatchObject({
      moderationState: 'normal',
      ownerVisibility: 'hidden',
      publiclyVisible: false,
    });
    expect((await owner.request.get('/api/v1/personas/' + works.maibot.id)).status()).toBe(404);
    expect(writes).toBe(4);
    await page.screenshot({ path: join(evidence, 'restored-hidden.png') });
  } finally {
    await ownerContext.close();
  }
});
