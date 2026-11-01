import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { OwnReportResponseSchema } from '@personamarket/contracts';
import { loginCreator, browserWrite } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { publishedVisualPersonas } from '../fixtures/visual-personas.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });
test('举报长内容覆盖九个视口，深色大字、有限高度、触控和确认焦点可用', async ({
  page,
  browser,
}, info) => {
  const options = {
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    viewport: page.viewportSize(),
  };
  const authorContext = await browser.newContext(options),
    reporterContext = await browser.newContext(options);
  const author = await authorContext.newPage(),
    reporter = await reporterContext.newPage();
  const directory = join('data/tests/reports/layout', info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  const errors: string[] = [];
  for (const target of [page, author, reporter])
    target.on('pageerror', (error) => errors.push(error.message));
  try {
    await loginCreator(author);
    await loginCreator(reporter);
    await loginBrowserAdmin(page);
    const title = '需要核对来源的春日书房角色'.repeat(4) + 'LongVersionName';
    const works = await publishedVisualPersonas(author, page, {
      titles: { maibot: title, astrbot: '另一平台的公开角色 ' + randomUUID().slice(0, 8) },
    });
    const details =
      '举报上下文与私有线索\n'.repeat(25) +
      '\nhttps://fixture.invalid/' +
      'long-evidence-file-name_'.repeat(45);
    const created = await browserWrite(
      reporter,
      '/api/v1/reports',
      {
        target: { type: 'persona', personaId: works.maibot.id, releaseId: works.maibot.releaseId },
        reason: 'copyright',
        details,
      },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(created.status()).toBe(200);
    const report = OwnReportResponseSchema.parse(await created.json()).data;
    const sizes =
      info.project.name === 'desktop'
        ? [
            [1366, 768],
            [1440, 900],
            [1920, 1080],
          ]
        : info.project.name === 'mobile'
          ? [
              [360, 800],
              [390, 844],
              [430, 932],
            ]
          : [
              [768, 1024],
              [960, 800],
              [1024, 768],
            ];
    const measurements = [];
    for (const [width = 390, height = 844] of sizes) {
      for (const target of [page, reporter]) await target.setViewportSize({ width, height });
      await reporter.goto('/dashboard/reports');
      const ownOpener = reporter.getByRole('button', { name: '查看举报：' + title, exact: true });
      await expect(ownOpener).toBeVisible();
      await reporter.evaluate(() => document.fonts.ready);
      expect((await ownOpener.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      expect(
        await reporter.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true);
      await reporter.screenshot({ path: join(directory, width + 'x' + height + '-own-list.png') });
      await ownOpener.click();
      const own = reporter.getByRole('dialog', { name: '举报详情', exact: true });
      await expect(own).toContainText(details);
      expect(await own.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
        true,
      );
      await reporter.screenshot({
        path: join(directory, width + 'x' + height + '-own-detail.png'),
      });
      await reporter.keyboard.press('Escape');
      await expect(own).not.toBeVisible();
      await expect(ownOpener).toBeFocused();
      await page.goto('/admin/reports');
      const opener = page.getByRole('button', { name: '查看举报：' + title, exact: true });
      await expect(opener).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: join(directory, width + 'x' + height + '-admin-list.png') });
      await opener.click();
      const panel = page.getByRole('dialog', { name: '处理举报', exact: true });
      await panel.getByRole('tab', { name: '线索', exact: true }).click();
      await expect(panel).toContainText(details);
      await panel.getByRole('tab', { name: '处理', exact: true }).click();
      expect(
        await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
      await panel
        .getByRole('heading', { name: '核对并处理', exact: true })
        .scrollIntoViewIfNeeded();
      expect(
        (await panel.getByRole('button', { name: '受理举报', exact: true }).boundingBox())?.height,
      ).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: join(directory, width + 'x' + height + '-admin-actions.png') });
      await page.keyboard.press('Escape');
      await expect(panel).not.toBeVisible();
      await expect(opener).toBeFocused();
      measurements.push({
        width,
        height,
        ownRootOverflow: false,
        adminRootOverflow: false,
        panelOverflow: false,
        openerHeight: (await opener.boundingBox())?.height,
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin/reports?report=' + report.id);
    const panel = page.getByRole('dialog', { name: '处理举报', exact: true });
    await panel.getByRole('tab', { name: '线索', exact: true }).click();
    await expect(panel).toContainText(details);
    await panel.getByRole('tab', { name: '处理', exact: true }).click();
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
      document.documentElement.style.fontSize = '200%';
    });
    await panel
      .getByLabel('举报人可见说明', { exact: true })
      .fill('核对公开来源，完整说明当前处理进展'.repeat(20));
    await panel
      .getByLabel('仅管理员可见备注', { exact: true })
      .fill('只在后台核对的证据和记录\n'.repeat(35));
    await panel.getByRole('button', { name: '核对处理操作', exact: true }).click();
    const confirmation = page.getByRole('alertdialog', { name: '确认受理举报', exact: true });
    await expect(confirmation).toBeVisible();
    expect(
      await confirmation.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
    const bounds = await confirmation.boundingBox();
    expect(bounds?.y).toBeGreaterThanOrEqual(0);
    expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(845);
    await page.screenshot({ path: join(directory, '390-dark-large-confirmation.png') });
    await page.keyboard.press('Escape');
    await expect(panel.getByRole('button', { name: '核对处理操作', exact: true })).toBeFocused();
    await panel.getByRole('button', { name: '完成处理', exact: true }).click();
    await panel.getByLabel('内容处置', { exact: true }).click();
    await page.getByRole('option', { name: '下架整个人设', exact: true }).click();
    await panel.getByLabel('账号处置', { exact: true }).click();
    await page.getByRole('option', { name: '封禁账号及全部作品', exact: true }).click();
    await panel
      .getByLabel('被处置者可见说明', { exact: true })
      .fill('被处置者可见的独立说明\n'.repeat(40));
    const resolutionBounds = [];
    for (const label of ['内容处置', '账号处置']) {
      const control = panel.getByLabel(label, { exact: true });
      const value = control.locator('[data-slot="select-value"]');
      resolutionBounds.push({
        label,
        ...(await value.evaluate((element) => ({
          width: element.clientWidth,
          scrollWidth: element.scrollWidth,
        }))),
      });
    }
    await panel.getByLabel('账号处置', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(directory, '390-dark-large-resolution.png') });
    await writeFile(
      join(directory, 'resolution-large-measurements.json'),
      JSON.stringify(resolutionBounds, null, 2),
    );
    for (const value of resolutionBounds)
      expect(value.scrollWidth, value.label).toBeLessThanOrEqual(value.width + 1);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
    await page.setViewportSize({ width: 390, height: 480 });
    const note = panel.getByLabel('仅管理员可见备注', { exact: true });
    await note.focus();
    await note.scrollIntoViewIfNeeded();
    const input = await note.boundingBox();
    expect(input?.y).toBeGreaterThanOrEqual(0);
    expect((input?.y ?? 0) + (input?.height ?? 0)).toBeLessThanOrEqual(481);
    await page.screenshot({ path: join(directory, '390-limited-height.png') });
    expect(errors).toEqual([]);
    await writeFile(
      join(directory, 'measurements.json'),
      JSON.stringify(
        {
          measurements,
          errors,
          scope:
            'Chromium 浏览器仿真；200% 根字号和有限可视高度，不代表实体手机、真实系统键盘或浏览器原生缩放',
        },
        null,
        2,
      ),
    );
  } finally {
    await Promise.all([authorContext.close(), reporterContext.close()]);
  }
});
