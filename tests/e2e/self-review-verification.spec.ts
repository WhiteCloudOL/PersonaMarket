import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createDatabase } from '@personamarket/database';
import { createAdministrator } from '@personamarket/server';
import {
  AuthContextResponseSchema,
  DraftResponseSchema,
  SubmissionResponseSchema,
} from '@personamarket/contracts';
import { browserWrite } from '../fixtures/browser-account.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });
async function capture(page: Page, name: string) {
  const size = page.viewportSize();
  if (!size) throw new Error('缺少浏览器视口');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const directory = join('data/tests/self-review/current', `${size.width}x${size.height}`);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, name + '.png'), fullPage: true });
  await page.screenshot({ path: join(directory, name + '-viewport.png') });
}

test('未绑定 MFA 的管理员使用较早的会话确认自审并直接发布', async ({ page }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test')) throw new Error('必须使用隔离测试库');
  const database = createDatabase(source);
  const username = 'self_' + randomUUID().replaceAll('-', '').slice(0, 12);
  const password = 'Optional self review browser passphrase 2026';
  try {
    await createAdministrator(database, {
      username,
      email: username + '@fixture.invalid',
      password,
    });
    await page.goto('/login');
    await page.getByLabel('用户名或邮箱').fill(username);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL(/\/account$/);
    const initialResponse = await browserWrite(page, '/api/v1/me/personas', {
      platform: 'maibot',
      title: '管理员自审身份确认验收',
    });
    expect(initialResponse.status()).toBe(200);
    const initial = DraftResponseSchema.parse(await initialResponse.json()).data;
    const saved = await browserWrite(
      page,
      '/api/v1/me/personas/' + initial.id + '/draft',
      {
        ...initial.draft,
        platform: 'maibot',
        summary: '核验管理员自审权限和确认',
        rightsAccepted: true,
        content: {
          personality: '喜欢自然与文学',
          replyStyle: '亲切自然',
          behaviorStyle: '认真倾听',
        },
      },
      'PUT',
      { 'If-Match': '"draft-1"' },
    );
    expect(saved.status()).toBe(200);
    const submitted = await browserWrite(
      page,
      '/api/v1/me/personas/' + initial.id + '/releases',
      {
        version: '1.0.0',
        expectedDraftRevision: 2,
        changelog: '核验未绑定MFA的高危自审',
        confirmed: true,
      },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(submitted.status()).toBe(200);
    const submission = SubmissionResponseSchema.parse(await submitted.json()).data;
    await database.pool.query(
      "UPDATE auth_sessions SET created_at=now()-interval '11 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
      [username],
    );
    await page.goto('/admin/moderation?submission=' + submission.id);
    const reason = '核实本人作品内容与来源后明确自审';
    await page.getByLabel('审核意见', { exact: true }).fill(reason);
    const confirmation = page.getByRole('checkbox', { name: /若为本人作品/ });
    await confirmation.check();
    await capture(page, 'review-before');
    const reviewPath = '/api/v1/admin/moderation/submissions/' + submission.id + '/review';
    const approved = page.waitForResponse(
      (response) => response.url().endsWith(reviewPath) && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '通过并发布', exact: true }).last().click();
    const result = await approved;
    expect(result.status()).toBe(200);
    expect(SubmissionResponseSchema.parse(await result.json()).data.status).toBe('APPROVED');
    await expect(page.getByLabel('审核意见', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: '验证高危操作', exact: true })).toHaveCount(0);
    const context = AuthContextResponseSchema.parse(
      await (await page.request.get('/api/v1/auth/context')).json(),
    ).data;
    expect(context.assurance).toBe('authenticated');
    expect(context.mfaEnabled).toBe(false);
    await capture(page, 'review-approved');
  } finally {
    await database.close();
  }
});
