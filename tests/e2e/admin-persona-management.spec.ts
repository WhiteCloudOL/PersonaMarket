import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  AdminPersonaBulkRequestSchema,
  AdminPersonaResponseSchema,
  AuthContextResponseSchema,
} from '@personamarket/contracts';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { browserWrite, loginCreator } from '../fixtures/browser-account.js';
import { visualPersonas } from '../fixtures/visual-personas.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });

test('批量管理逐项处理真实冲突，明确重新核对后重试且已成功项不会再次提交', async ({
  page,
  browser,
}, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  const baseURL = process.env['PLAYWRIGHT_ORIGIN'];
  if (!baseURL) throw new Error('必须使用隔离测试站点');
  const context = await browser.newContext({ baseURL });
  const author = await context.newPage();
  const directory = join('data/tests/admin-personas', info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  try {
    await loginBrowserAdmin(page);
    await loginCreator(author);
    const works = await visualPersonas(author, page);
    const owner = AuthContextResponseSchema.parse(
      await (await author.request.get('/api/v1/auth/context')).json(),
    ).data.account;
    if (!owner) throw new Error('缺少已登录的测试作者');
    await page.goto('/admin/personas?ownerId=' + owner.id);
    await page.getByRole('checkbox', { name: '选择' + works.maibot.title, exact: true }).check();
    await page.getByRole('checkbox', { name: '选择' + works.astrbot.title, exact: true }).check();
    const current = AdminPersonaResponseSchema.parse(
      await (await page.request.get('/api/v1/admin/personas/' + works.maibot.id)).json(),
    ).data;
    expect(
      (
        await browserWrite(
          page,
          '/api/v1/admin/personas/' + works.maibot.id + '/curation',
          {
            official: true,
            featured: false,
            reason: '另一位管理员先更新了运营标记',
            expectedRevision: current.revision,
          },
          'PUT',
          { 'Idempotency-Key': randomUUID() },
        )
      ).status(),
    ).toBe(200);
    await page.getByRole('button', { name: '管理所选人设', exact: true }).click();
    const panel = page.getByRole('dialog', { name: '批量管理人设', exact: true });
    await panel.getByRole('checkbox', { name: '精选作品', exact: true }).check();
    await panel
      .getByLabel('批量处理理由', { exact: true })
      .fill('逐项核对公开作品\n<script>window.UNTRUSTED=1</script>');
    await panel.getByRole('button', { name: '核对本批操作', exact: true }).click();
    await expect(panel.getByText('请确认本批操作', { exact: true })).toBeVisible();
    const firstRequest = page.waitForRequest(
      (request) => request.url().endsWith('/admin/personas/bulk') && request.method() === 'POST',
    );
    await panel.getByRole('button', { name: '确认执行本批操作', exact: true }).click();
    const firstBody = AdminPersonaBulkRequestSchema.parse((await firstRequest).postDataJSON());
    await expect(panel.getByText('已确认成功 1 条 · 待核对 1 条', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: '重试未完成项', exact: true })).toBeEnabled();
    await page.screenshot({ path: join(directory, 'bulk-partial.png') });
    const retriedRequest = page.waitForRequest(
      (request) => request.url().endsWith('/admin/personas/bulk') && request.method() === 'POST',
    );
    await panel.getByRole('button', { name: '重试未完成项', exact: true }).click();
    const retriedBody = AdminPersonaBulkRequestSchema.parse((await retriedRequest).postDataJSON());
    expect(firstBody).toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ id: works.maibot.id })]),
    });
    const first = firstBody.items.find((item) => item.id === works.maibot.id);
    expect(first).toBeDefined();
    expect(retriedBody).toMatchObject({
      items: [
        expect.objectContaining({ id: works.maibot.id, idempotencyKey: first?.idempotencyKey }),
      ],
    });
    await expect(
      panel.getByRole('button', { name: '核对这条作品的最新修订', exact: true }),
    ).toBeEnabled();
    await panel.getByRole('button', { name: '核对这条作品的最新修订', exact: true }).click();
    await panel
      .getByRole('button', { name: '采用这条作品的最新修订并重新确认', exact: true })
      .click();
    await panel.getByRole('button', { name: '确认执行本批操作', exact: true }).click();
    await expect(panel.getByText('已确认成功 2 条 · 待核对 0 条', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: '结束本批操作', exact: true })).toBeEnabled();
    await page.screenshot({ path: join(directory, 'bulk-complete.png') });
    expect(await page.evaluate(() => 'UNTRUSTED' in window)).toBe(false);
    await panel.getByRole('button', { name: '结束本批操作', exact: true }).click();
    await expect(panel).not.toBeVisible();
    for (const work of [works.maibot, works.astrbot]) {
      const response = await page.request.get('/api/v1/admin/personas/' + work.id);
      expect(response.status()).toBe(200);
      expect(AdminPersonaResponseSchema.parse(await response.json()).data.curation).toEqual({
        official: false,
        featured: true,
      });
    }
  } finally {
    await context.close();
  }
});

test('上下架保留冲突理由，经确认后真实生效，恢复不改变发布版本并展示管理记录', async ({
  page,
  browser,
}, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  const baseURL = process.env['PLAYWRIGHT_ORIGIN'];
  if (!baseURL) throw new Error('必须使用隔离测试站点');
  const context = await browser.newContext({ baseURL });
  const author = await context.newPage();
  const directory = join('data/tests/admin-personas', info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  try {
    await loginBrowserAdmin(page);
    await loginCreator(author);
    const works = await visualPersonas(author, page);
    const id = works.astrbot.id;
    await page.goto('/admin/personas?q=' + id);
    await page.getByRole('button', { name: '管理这条人设', exact: true }).click();
    const panel = page.getByRole('dialog', { name: '管理人设', exact: true });
    const current = AdminPersonaResponseSchema.parse(
      await (await page.request.get('/api/v1/admin/personas/' + id)).json(),
    ).data;
    const reason =
      '已核对举报依据，需要暂停公开展示\nhttps://example.invalid/' + '很长的依据'.repeat(90);
    await panel.getByLabel('上下架理由', { exact: true }).fill(reason);
    expect(
      (
        await browserWrite(
          page,
          '/api/v1/admin/personas/' + id + '/curation',
          {
            official: false,
            featured: true,
            reason: '并发变更推荐标记',
            expectedRevision: current.revision,
          },
          'PUT',
          { 'Idempotency-Key': randomUUID() },
        )
      ).status(),
    ).toBe(200);
    await panel.getByRole('button', { name: '准备下架人设', exact: true }).click();
    const confirmation = page.getByRole('alertdialog');
    await expect(confirmation.getByRole('heading', { name: '确认下架这条人设' })).toBeVisible();
    const conflict = page.waitForResponse(
      (response) =>
        response.url().endsWith('/admin/personas/' + id + '/moderation') &&
        response.request().method() === 'POST',
    );
    await confirmation.getByRole('button', { name: '确认处理', exact: true }).click();
    expect((await conflict).status()).toBe(412);
    await expect(panel.getByLabel('上下架理由', { exact: true })).toHaveValue(reason);
    expect((await author.request.get('/api/v1/personas/' + id)).status()).toBe(200);
    await panel.getByRole('button', { name: '核对上下架状态', exact: true }).click();
    await panel.getByRole('button', { name: '使用最新状态继续核对', exact: true }).click();
    await panel.getByRole('button', { name: '准备下架人设', exact: true }).click();
    await page.screenshot({ path: join(directory, 'moderation-confirm.png') });
    const blocked = page.waitForResponse(
      (response) =>
        response.url().endsWith('/admin/personas/' + id + '/moderation') &&
        response.request().method() === 'POST',
    );
    await confirmation.getByRole('button', { name: '确认处理', exact: true }).click();
    expect((await blocked).status()).toBe(200);
    await expect(panel.getByRole('button', { name: '准备恢复人设', exact: true })).toBeEnabled();
    expect((await author.request.get('/api/v1/personas/' + id)).status()).toBe(404);
    await panel.getByRole('heading', { name: '管理记录', exact: true }).scrollIntoViewIfNeeded();
    await expect(panel.getByText(reason, { exact: true })).toBeVisible();
    await page.screenshot({ path: join(directory, 'moderation-records.png') });
    await panel.getByLabel('上下架理由', { exact: true }).fill('复核完成，解除管理员下架');
    await panel.getByRole('button', { name: '准备恢复人设', exact: true }).click();
    const restored = page.waitForResponse(
      (response) =>
        response.url().endsWith('/admin/personas/' + id + '/moderation') &&
        response.request().method() === 'POST',
    );
    await confirmation.getByRole('button', { name: '确认处理', exact: true }).click();
    expect((await restored).status()).toBe(200);
    await expect(panel.getByRole('button', { name: '准备下架人设', exact: true })).toBeEnabled();
    const after = AdminPersonaResponseSchema.parse(
      await (await page.request.get('/api/v1/admin/personas/' + id)).json(),
    ).data;
    expect(after.publishedReleaseId).toBe(current.publishedReleaseId);
    expect((await author.request.get('/api/v1/personas/' + id)).status()).toBe(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await context.close();
  }
});
