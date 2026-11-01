import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { loginCreator } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { publishedVisualPersonas } from '../fixtures/visual-personas.js';

test.use({
  trace: 'off',
  screenshot: 'off',
  hasTouch: true,
  isMobile: true,
  viewport: { width: 390, height: 844 },
});
test('触控浏览器可选择举报原因、在有限高度编辑长说明并提交真实举报', async ({
  page,
  browser,
}, info) => {
  const authorContext = await browser.newContext({
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
  });
  try {
    const author = await authorContext.newPage();
    await loginCreator(author);
    await loginBrowserAdmin(page);
    const works = await publishedVisualPersonas(author, page, {
      titles: {
        maibot: '触控举报的真实公开作品 ' + randomUUID().slice(0, 8),
        astrbot: '触控公开参照 ' + randomUUID().slice(0, 8),
      },
    });
    await page.goto('/personas/' + works.maibot.id);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    const trigger = page.getByRole('button', { name: '举报人设', exact: true });
    await expect(trigger).toBeEnabled();
    await trigger.tap();
    const panel = page.getByRole('dialog', { name: '举报人设', exact: true });
    const reason = panel.getByLabel('举报原因', { exact: true });
    expect((await reason.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await reason.tap();
    const option = page.getByRole('option', { name: '垃圾广告', exact: true });
    expect((await option.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await option.tap();
    await page.setViewportSize({ width: 390, height: 480 });
    const details = panel.getByLabel('补充说明', { exact: true });
    await details.fill('逐行记录需要核对的公开问题\n'.repeat(50));
    await details.tap();
    await details.scrollIntoViewIfNeeded();
    const box = await details.boundingBox();
    expect(box?.y).toBeGreaterThanOrEqual(0);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(481);
    await expect
      .poll(() => details.evaluate((element) => element.scrollHeight > element.clientHeight))
      .toBe(true);
    await panel.getByRole('button', { name: '提交举报', exact: true }).tap();
    await expect(panel).toContainText('举报已提交');
    await page.setViewportSize({ width: 390, height: 844 });
    await panel.getByRole('link', { name: '查看这条举报', exact: true }).tap();
    await expect(page.getByRole('dialog', { name: '举报详情', exact: true })).toContainText(
      '垃圾广告',
    );
    const directory = join('data/tests/reports/touch', info.project.name, randomUUID());
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: join(directory, '390-touch-submitted.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await authorContext.close();
  }
});
