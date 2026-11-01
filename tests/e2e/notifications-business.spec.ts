import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { CommentResponseSchema, NotificationsResponseSchema } from '@personamarket/contracts';
import { loginCreator, browserWrite } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { publishedVisualPersonas } from '../fixtures/visual-personas.js';

test.use({ trace: 'off', screenshot: 'off' });
test('审核通知打开本人版本页，首次公开回复通知打开真实楼层', async ({ page, browser }) => {
  await loginCreator(page);
  const options = {
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    viewport: page.viewportSize(),
  };
  const adminContext = await browser.newContext(options),
    writerContext = await browser.newContext(options);
  const admin = await adminContext.newPage(),
    writer = await writerContext.newPage();
  try {
    await loginBrowserAdmin(admin);
    await loginCreator(writer);
    const works = await publishedVisualPersonas(page, admin, {
      titles: {
        maibot: '审核通知真实跳转 ' + randomUUID().slice(0, 8),
        astrbot: '另一平台通知 ' + randomUUID().slice(0, 8),
      },
    });
    const inbox = async () =>
      NotificationsResponseSchema.parse(
        await (await page.request.get('/api/v1/me/notifications')).json(),
      ).data;
    await expect
      .poll(async () => (await inbox()).filter((row) => row.kind === 'release_approved').length)
      .toBe(2);
    await page.goto('/dashboard/notifications');
    await page.locator('a[href="/dashboard/personas/' + works.maibot.id + '/releases"]').click();
    await expect(page).toHaveURL(
      new RegExp('/dashboard/personas/' + works.maibot.id + '/releases$'),
    );
    await expect(
      page.getByRole('heading', { name: '发布记录', level: 1, exact: true }),
    ).toBeVisible();
    const commentPath = '/api/v1/personas/' + works.maibot.id + '/comments';
    const root = CommentResponseSchema.parse(
      await (
        await browserWrite(page, commentPath, { body: '接收回复通知的真实楼层' }, 'POST', {
          'Idempotency-Key': randomUUID(),
        })
      ).json(),
    ).data;
    const review = async (comment: typeof root) => {
      expect(
        (
          await browserWrite(
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
          )
        ).status(),
      ).toBe(200);
    };
    await review(root);
    const reply = CommentResponseSchema.parse(
      await (
        await browserWrite(
          writer,
          commentPath,
          { body: '实际公开后的回复正文', parentId: root.id },
          'POST',
          { 'Idempotency-Key': randomUUID() },
        )
      ).json(),
    ).data;
    expect((await inbox()).filter((row) => row.kind === 'comment_reply')).toHaveLength(0);
    await review(reply);
    await expect
      .poll(async () => (await inbox()).filter((row) => row.kind === 'comment_reply').length)
      .toBe(1);
    await page.goto('/dashboard/notifications');
    await page
      .getByLabel('通知：你收到一条公开回复', { exact: true })
      .getByRole('link', { name: '查看相关内容', exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp('#comment-' + reply.id + '$'));
    await expect(page.locator('#comment-' + reply.id)).toContainText('实际公开后的回复正文');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await adminContext.close();
    await writerContext.close();
  }
});
