import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { AuthContextResponseSchema, DraftResponseSchema } from '@personamarket/contracts';
import { createDatabase } from '@personamarket/database';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { browserWrite, loginCreator } from '../fixtures/browser-account.js';

test.use({ trace: 'off', screenshot: 'off' });

test('删除账号和人设需要明确确认，待审人设在账号菜单显示红标', async ({ page, browser }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  const baseURL = process.env['PLAYWRIGHT_ORIGIN'];
  if (!baseURL) throw new Error('缺少隔离站点地址');
  const administrator = await loginBrowserAdmin(page);
  const context = await browser.newContext({ baseURL });
  const creator = await context.newPage();
  try {
    const account = await loginCreator(creator);
    const author = AuthContextResponseSchema.parse(
      await (await creator.request.get('/api/v1/auth/context')).json(),
    ).data.account;
    if (!author) throw new Error('缺少作者会话');
    const initial = await browserWrite(creator, '/api/v1/me/personas', {
      platform: 'maibot',
      title: '待删除的测试人设',
    });
    expect(initial.status()).toBe(200);
    const draft = DraftResponseSchema.parse(await initial.json()).data;
    const edited = await browserWrite(
      creator,
      `/api/v1/me/personas/${draft.id}/draft`,
      {
        ...draft.draft,
        platform: 'maibot',
        summary: '验证后台删除流程',
        rightsAccepted: true,
        content: { personality: '温和', replyStyle: '简短', behaviorStyle: '倾听' },
      },
      'PUT',
      { 'If-Match': '"draft-1"' },
    );
    expect(edited.status()).toBe(200);
    const submitted = await browserWrite(
      creator,
      `/api/v1/me/personas/${draft.id}/releases`,
      {
        version: '1.0.0',
        expectedDraftRevision: 2,
        confirmed: true,
      },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(submitted.status()).toBe(200);
    await page.goto(`/admin/personas?q=${draft.id}`);
    const accountMenu = page.getByRole('button', { name: '打开账号菜单', exact: true });
    await expect(accountMenu).toHaveAttribute('aria-description', '有审核待办');
    await accountMenu.click();
    if (info.project.name === 'desktop') {
      await page.getByRole('menuitem', { name: '审核', exact: true }).hover();
      await expect(page.getByRole('menuitem', { name: '内容审核', exact: true })).toHaveAttribute(
        'aria-description',
        '有待处理事项',
      );
    } else {
      await page.getByRole('tab', { name: '审核', exact: true }).click();
      await expect(page.getByRole('link', { name: '内容审核', exact: true })).toHaveAttribute(
        'aria-description',
        '有待处理事项',
      );
    }
    await page.screenshot({ path: info.outputPath('review-indicator.png') });
    await page.reload();
    await page.getByRole('button', { name: '管理这条人设', exact: true }).click();
    await page.getByRole('button', { name: '删除人设', exact: true }).click();
    const persona = page.getByRole('alertdialog', { name: '删除人设', exact: true });
    await expect(persona.getByRole('button', { name: '取消', exact: true })).toBeFocused();
    await page.screenshot({ path: info.outputPath('delete-persona.png') });
    const removedPersona = page.waitForResponse((response) =>
      response.url().endsWith(`/admin/personas/${draft.id}/delete`),
    );
    await persona.getByRole('button', { name: '永久删除', exact: true }).click();
    expect((await removedPersona).status()).toBe(200);
    await expect(persona).toBeHidden();
    await expect(accountMenu).not.toHaveAttribute('aria-description', '有审核待办');

    await page.goto(`/admin/users?userId=${author.id}`);
    await page.getByRole('button', { name: '删除账号', exact: true }).click();
    const user = page.getByRole('alertdialog', { name: '删除账号', exact: true });
    const confirm = user.getByRole('button', { name: '永久删除', exact: true });
    await expect(confirm).toBeDisabled();
    await user.getByRole('button', { name: '匿名保留', exact: true }).click();
    await expect(confirm).toBeDisabled();
    await user.getByLabel('输入用户名确认', { exact: true }).fill(account.username);
    await page.screenshot({ path: info.outputPath('delete-user.png') });
    const source = process.env['TEST_DATABASE_URL'];
    if (!source || !new URL(source).pathname.endsWith('_test'))
      throw new Error('缺少隔离测试数据库');
    const database = createDatabase(source);
    try {
      await database.pool.query(
        `UPDATE auth_sessions SET mfa_verified_at=now()-interval '11 minutes'
        WHERE user_id=(SELECT id FROM users WHERE username=$1)`,
        [administrator.username],
      );
    } finally {
      await database.close();
    }
    const needsVerification = page.waitForResponse((response) =>
      response.url().endsWith(`/admin/users/${author.id}/delete`),
    );
    await confirm.click();
    expect((await needsVerification).status()).toBe(403);
    const verification = page.getByRole('dialog', { name: '验证高危操作', exact: true });
    await verification
      .getByLabel('动态验证码或恢复码', { exact: true })
      .fill(administrator.recoveryCode);
    await verification.getByRole('button', { name: '确认身份', exact: true }).click();
    await expect(verification).toBeHidden();
    await expect(user.getByLabel('输入用户名确认', { exact: true })).toHaveValue(account.username);
    const removedUser = page.waitForResponse((response) =>
      response.url().endsWith(`/admin/users/${author.id}/delete`),
    );
    await confirm.click();
    expect((await removedUser).status()).toBe(200);
    await expect(user).toBeHidden();
    expect((await creator.request.get('/api/v1/me/personas')).status()).toBe(401);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await context.close();
  }
});
