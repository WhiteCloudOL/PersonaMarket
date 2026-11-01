import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page, type Browser } from '@playwright/test';
import {
  AdminReportResponseSchema,
  OwnReportsResponseSchema,
  OwnReportResponseSchema,
  CommentResponseSchema,
  AdminCommentResponseSchema,
  reportEtag,
} from '@personamarket/contracts';
import { loginCreator, browserWrite } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { publishedVisualPersonas } from '../fixtures/visual-personas.js';

test.use({ trace: 'off', screenshot: 'off' });
async function contexts(page: Page, browser: Browser) {
  const options = {
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    viewport: page.viewportSize(),
  };
  const authorContext = await browser.newContext(options),
    adminContext = await browser.newContext(options);
  const author = await authorContext.newPage(),
    admin = await adminContext.newPage();
  await loginCreator(author);
  await loginBrowserAdmin(admin);
  await loginCreator(page);
  const works = await publishedVisualPersonas(author, admin, {
    titles: {
      maibot: '举报与处理的真实作品 ' + randomUUID().slice(0, 8),
      astrbot: '举报隔离参照 ' + randomUUID().slice(0, 8),
    },
  });
  return {
    author,
    admin,
    works,
    close: () => Promise.all([authorContext.close(), adminContext.close()]),
  };
}

test('人设举报保留断网输入，管理并发重试保留说明和最新修订，私有备注不向举报人泄露', async ({
  page,
  browser,
}, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await contexts(page, browser);
  const { admin, author, works } = fixture;
  const directory = join('data/tests/reports/flow', info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  const milestones: Array<{ step: string; at: string; status?: number }> = [];
  async function mark(step: string, status?: number) {
    milestones.push({
      step,
      at: new Date().toISOString(),
      ...(status !== undefined ? { status } : {}),
    });
    await writeFile(join(directory, 'fault-injection.json'), JSON.stringify(milestones, null, 2));
  }
  let injectionError: unknown;
  try {
    await page.goto('/personas/' + works.maibot.id);
    await page.getByRole('button', { name: '举报人设', exact: true }).click();
    const form = page.getByRole('dialog', { name: '举报人设', exact: true });
    await form.getByLabel('举报原因', { exact: true }).click();
    await page.getByRole('option', { name: '侵权或来源问题', exact: true }).click();
    const details =
      '私有举报线索 <script>window.reportXss=1</script>\nhttps://fixture.invalid/' +
      'long-source-'.repeat(16);
    await form.getByLabel('补充说明', { exact: true }).fill(details);
    await page.route(
      '**/api/v1/reports',
      async (route) => {
        const result = await route.fetch();
        expect(result.status()).toBe(200);
        await route.abort('connectionreset');
      },
      { times: 1 },
    );
    await form.getByRole('button', { name: '提交举报', exact: true }).click();
    await expect(form).toContainText('当前输入已保留');
    await expect(form.getByLabel('补充说明', { exact: true })).toHaveValue(details);
    await page.screenshot({ path: join(directory, 'create-retry.png') });
    const retried = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/v1/reports' && r.request().method() === 'POST',
    );
    await form.getByRole('button', { name: '提交举报', exact: true }).click();
    expect((await retried).status()).toBe(200);
    await expect(form).toContainText('举报已提交');
    const mine = OwnReportsResponseSchema.parse(
      await (await page.request.get('/api/v1/me/reports')).json(),
    );
    expect(mine.meta.total).toBe(1);
    const id = mine.data[0]?.id;
    if (!id) throw new Error('缺少真实举报');
    await form.getByRole('link', { name: '查看这条举报', exact: true }).click();
    const ownPanel = page.getByRole('dialog', { name: '举报详情', exact: true });
    await expect(ownPanel).toContainText(details);
    expect(await page.evaluate(() => 'reportXss' in window)).toBe(false);
    expect((await author.request.get('/api/v1/me/reports/' + id)).status()).toBe(404);
    await page.screenshot({ path: join(directory, 'own-submitted.png') });
    await admin.goto('/admin/reports?report=' + id);
    const panel = admin.getByRole('dialog', { name: '处理举报', exact: true });
    await panel.getByRole('tab', { name: '线索', exact: true }).click();
    await expect(panel).toContainText(details);
    await panel.getByRole('tab', { name: '处理', exact: true }).click();
    await panel.getByLabel('举报人可见说明', { exact: true }).fill('已经受理，正在核实公开来源');
    await panel
      .getByLabel('仅管理员可见备注', { exact: true })
      .fill('绝不向举报人展示的后台核验备注');
    await panel.getByRole('button', { name: '核对处理操作', exact: true }).click();
    const confirmation = admin.getByRole('alertdialog', { name: '确认受理举报', exact: true });
    await expect(confirmation).toContainText('仅管理员可见备注');
    await admin.screenshot({ path: join(directory, 'admin-confirmation.png') });
    await admin.keyboard.press('Escape');
    await expect(panel.getByRole('button', { name: '核对处理操作', exact: true })).toBeFocused();
    await mark('confirmation_cancelled_focus_restored');
    await admin.route(
      '**/api/v1/admin/reports/' + id + '/actions',
      async (route) => {
        try {
          await mark('fault_entered');
          const result = await route.fetch();
          await mark('accept_response', result.status());
          expect(result.status()).toBe(200);
          const accepted = AdminReportResponseSchema.parse(await result.json()).data;
          await mark('before_additional_note');
          const later = await browserWrite(
            admin,
            '/api/v1/admin/reports/' + id + '/actions',
            {
              action: 'note',
              message: '',
              privateNote: '响应丢失后的另一条内部记录',
              selfReviewConfirmed: false,
              confirmed: true,
            },
            'POST',
            { 'If-Match': reportEtag(id, accepted.revision), 'Idempotency-Key': randomUUID() },
          );
          expect(later.status()).toBe(200);
          await mark('additional_note_response', later.status());
        } catch (cause) {
          injectionError = cause;
          await mark('fault_failed');
        } finally {
          await route.abort('connectionreset').catch(() => undefined);
          await mark('fault_aborted');
        }
      },
      { times: 1 },
    );
    await panel.getByRole('button', { name: '核对处理操作', exact: true }).click();
    await confirmation.getByRole('button', { name: '确认保存处理记录', exact: true }).click();
    await mark('first_submission_clicked');
    await expect(panel).toContainText('当前输入已保留');
    if (injectionError) throw injectionError;
    await mark('first_failure_feedback');
    await expect(panel.getByLabel('举报人可见说明', { exact: true })).toHaveValue(
      '已经受理，正在核实公开来源',
    );
    await panel.getByRole('button', { name: '核对处理操作', exact: true }).click();
    await confirmation.getByRole('button', { name: '确认保存处理记录', exact: true }).click();
    await expect(panel).toContainText('服务器还有后续修订');
    await mark('idempotent_replay_with_newer_revision');
    await expect(panel.getByLabel('仅管理员可见备注', { exact: true })).toHaveValue(
      '绝不向举报人展示的后台核验备注',
    );
    await panel.getByRole('button', { name: '采用最新修订并保留输入', exact: true }).click();
    await panel.getByRole('button', { name: '完成处理', exact: true }).click();
    await expect(panel.getByLabel('内容处置', { exact: true })).toContainText('保留当前内容');
    await expect(panel.getByLabel('被处置者可见说明', { exact: true })).toHaveCount(0);
    await panel.getByLabel('举报人可见说明', { exact: true }).fill('已核实来源并完成处理');
    await panel.getByRole('button', { name: '核对处理操作', exact: true }).click();
    await admin
      .getByRole('alertdialog', { name: '确认完成处理', exact: true })
      .getByRole('button', { name: '确认保存处理记录', exact: true })
      .click();
    await expect(panel).toContainText('处理记录已保存');
    await admin.screenshot({ path: join(directory, 'admin-completed.png') });
    await page.reload();
    await ownPanel.getByRole('tab', { name: '记录', exact: true }).click();
    await expect(ownPanel).toContainText('已核实来源并完成处理');
    await expect(ownPanel).not.toContainText('绝不向举报人展示');
    await expect(ownPanel).not.toContainText('响应丢失后的另一条内部记录');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: join(directory, 'own-completed.png') });
    const actual = OwnReportResponseSchema.parse(
      await (await page.request.get('/api/v1/me/reports/' + id)).json(),
    );
    expect(actual.data).toMatchObject({ status: 'resolved', revision: 4 });
    expect((await page.request.get('/api/v1/personas/' + works.maibot.id)).status()).toBe(200);
    await mark('flow_complete');
  } catch (cause) {
    await writeFile(
      join(directory, 'failure.json'),
      JSON.stringify(
        { message: cause instanceof Error ? cause.message : 'unknown', milestones },
        null,
        2,
      ),
    );
    throw cause;
  } finally {
    await admin.unrouteAll({ behavior: 'ignoreErrors' });
    await fixture.close();
  }
});

test('公开评论可以提交举报，隐藏后保留内容快照，未登录与普通用户权限反馈可用', async ({
  page,
  browser,
}, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await contexts(page, browser);
  const { author, admin, works } = fixture;
  try {
    const created = await browserWrite(
      author,
      '/api/v1/personas/' + works.maibot.id + '/comments',
      { body: '需要核对的已获批评论 ' + randomUUID().slice(0, 8) },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(created.status()).toBe(200);
    const comment = CommentResponseSchema.parse(await created.json()).data;
    const reviewed = await browserWrite(
      admin,
      '/api/v1/admin/comments/' + comment.id + '/review',
      {
        revisionId: comment.latest.id,
        expectedRevision: comment.revision,
        decision: 'approve',
        reason: '',
      },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(reviewed.status()).toBe(200);
    const approved = AdminCommentResponseSchema.parse(await reviewed.json()).data;
    await page.goto('/personas/' + works.maibot.id + '#comments');
    const floor = page
      .getByRole('article', { name: '评论楼层', exact: true })
      .filter({ hasText: comment.latest.body });
    await floor.getByRole('button', { name: '举报评论', exact: true }).click();
    const panel = page.getByRole('dialog', { name: '举报评论', exact: true });
    await panel.getByLabel('补充说明', { exact: true }).fill('核实公开评论的具体上下文');
    await panel.getByRole('button', { name: '提交举报', exact: true }).click();
    await expect(panel).toContainText('举报已提交');
    const mine = OwnReportsResponseSchema.parse(
      await (await page.request.get('/api/v1/me/reports')).json(),
    );
    const id = mine.data[0]?.id;
    if (!id) throw new Error('缺少评论举报');
    expect(
      (
        await browserWrite(
          admin,
          '/api/v1/admin/comments/' + comment.id + '/visibility',
          {
            expectedRevision: approved.revision,
            hidden: true,
            reason: '核实举报目标隐藏后的证据保留',
          },
          'PUT',
          { 'Idempotency-Key': randomUUID() },
        )
      ).status(),
    ).toBe(200);
    await panel.getByRole('link', { name: '查看这条举报', exact: true }).click();
    const own = page.getByRole('dialog', { name: '举报详情', exact: true });
    await expect(own).toContainText(comment.latest.body);
    await expect(own).toContainText('目标暂不可公开访问');
    await own.getByRole('button', { name: '关闭举报详情', exact: true }).click();
    await page.goto('/admin/reports');
    await expect(page.getByText('你没有举报管理权限', { exact: true })).toBeVisible();
    await page.context().clearCookies();
    await page.reload();
    await expect(page.getByText('请先登录', { exact: true })).toBeVisible();
  } finally {
    await fixture.close();
  }
});
