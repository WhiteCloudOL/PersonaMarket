import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { AdminCommentResponseSchema, CommentResponseSchema } from '@personamarket/contracts';
import { loginCreator, browserWrite } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { visualPersonas } from '../fixtures/visual-personas.js';

test.use({ trace: 'off', screenshot: 'off' });
test('举报入口和私有工作区的实际截图基线', async ({ page, browser }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  const adminContext = await browser.newContext({
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    viewport: page.viewportSize(),
  });
  const admin = await adminContext.newPage();
  const phase = process.env['REPORTS_CAPTURE_PHASE'] === 'before' ? 'before' : 'after';
  const directory = join('data/tests/reports', phase, info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  try {
    await loginCreator(page);
    await loginBrowserAdmin(admin);
    const works = await visualPersonas(page, admin, {
      titles: {
        maibot: '举报布局基线 ' + randomUUID().slice(0, 8),
        astrbot: '举报版本参照 ' + randomUUID().slice(0, 8),
      },
    });
    const created = await browserWrite(
      page,
      '/api/v1/personas/' + works.maibot.id + '/comments',
      { body: '供举报布局核对的公开评论' },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(created.status()).toBe(200);
    const comment = CommentResponseSchema.parse(await created.json()).data;
    const approved = await browserWrite(
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
    expect(approved.status()).toBe(200);
    AdminCommentResponseSchema.parse(await approved.json());
    await page.goto('/personas/' + works.maibot.id);
    await expect(page.getByRole('heading', { level: 1, name: works.maibot.title })).toBeVisible();
    await expect(page.getByRole('button', { name: '点赞', exact: true })).toBeEnabled();
    if (phase === 'after')
      await expect(page.getByRole('button', { name: '举报人设', exact: true })).toBeVisible();
    for (const image of await page.locator('#main img').all()) {
      if (await image.isVisible())
        await expect
          .poll(() =>
            image.evaluate(
              (element) =>
                element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0,
            ),
          )
          .toBe(true);
    }
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(directory, 'persona.png') });
    await page.locator('#comments').scrollIntoViewIfNeeded();
    await expect(
      page
        .getByRole('article', { name: '评论楼层', exact: true })
        .getByText('供举报布局核对的公开评论', { exact: true }),
    ).toBeVisible();
    if (phase === 'after')
      await expect(
        page
          .getByRole('article', { name: '评论楼层', exact: true })
          .getByRole('button', { name: '举报评论', exact: true }),
      ).toBeVisible();
    await page.screenshot({ path: join(directory, 'comments.png') });
    const own = await page.goto('/dashboard/reports');
    expect(own?.status()).toBe(phase === 'before' ? 404 : 200);
    if (phase === 'after')
      await expect(page.getByText('没有符合条件的举报', { exact: true })).toBeVisible();
    await page.screenshot({ path: join(directory, 'own.png') });
    const queue = await admin.goto('/admin/reports');
    expect(queue?.status()).toBe(phase === 'before' ? 404 : 200);
    if (phase === 'after')
      await expect(admin.getByRole('button', { name: '刷新举报列表', exact: true })).toBeEnabled();
    await admin.screenshot({ path: join(directory, 'queue.png') });
    await writeFile(
      join(directory, 'capture.json'),
      JSON.stringify(
        { viewport: page.viewportSize(), own: own?.status(), queue: queue?.status() },
        null,
        2,
      ),
    );
  } finally {
    await adminContext.close();
  }
});
