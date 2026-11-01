import { selectTheme } from '../fixtures/theme.js';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { AdminGuideResponseSchema, guideEtag } from '@personamarket/contracts';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { browserWrite, loginCreator } from '../fixtures/browser-account.js';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });
test('指南长内容覆盖九个重点视口，深色大字、焦点恢复、触控与有限高度输入可用', async ({
  page,
  browser,
}, info) => {
  const baseURL = process.env['PLAYWRIGHT_ORIGIN'];
  if (!baseURL) throw new Error('必须使用隔离站点');
  const directory = join('data/tests/guides-layout', info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  const guestContext = await browser.newContext({ baseURL }),
    authorContext = await browser.newContext({ baseURL });
  let release: (() => void) | undefined;
  const errors: string[] = [];
  try {
    const guest = await guestContext.newPage(),
      author = await authorContext.newPage();
    for (const target of [page, guest, author])
      target.on('pageerror', (error) => errors.push(error.message));
    await guest.goto('/admin/guides');
    await expect(guest.getByRole('heading', { name: '请先登录', exact: true })).toBeVisible();
    expect((await guest.request.get('/api/v1/admin/guides')).status()).toBe(401);
    await loginCreator(author);
    await author.goto('/admin/guides');
    await expect(
      author.getByRole('heading', { name: '你没有指南管理权限', exact: true }),
    ).toBeVisible();
    expect((await author.request.get('/api/v1/admin/guides')).status()).toBe(403);
    await loginBrowserAdmin(page);
    const endpoint = '/api/v1/admin/guides/maibot';
    const initial = AdminGuideResponseSchema.parse(
      await (await page.request.get(endpoint)).json(),
    ).data;
    const title = '星光创作与原生文件使用说明'.repeat(6) + 'LongNativeGuide'.repeat(2);
    const longWord = 'very-long-native-file-name_'.repeat(20) + '.toml';
    const body =
      '# 长正文标题\n\n' +
      '中文使用步骤、平台版本和角色说明，阅读后再确认导入。'.repeat(12) +
      '\n\n' +
      longWord +
      '\n\n```toml\nname = "' +
      longWord +
      '"\n```\n\n| 文件 | 说明 |\n| --- | --- |\n| ' +
      longWord +
      ' | 安全的原生示例 |\n\n[长地址](https://example.invalid/' +
      longWord +
      ')\n\n' +
      '### 更多步骤\n\n请按教程核对正文，不在自动化检查中连接实际机器人账号\n\n'.repeat(8);
    const response = await browserWrite(
      page,
      endpoint,
      {
        title,
        summary: '长中文和文件名的公开教程，用于核对桌面、手机、深色和大字阅读',
        bodyMarkdown: body,
        reason: '准备隔离的长指南样本',
      },
      'PATCH',
      { 'If-Match': guideEtag('maibot', initial.revision), 'Idempotency-Key': randomUUID() },
    );
    expect(response.status()).toBe(200);
    const edited = AdminGuideResponseSchema.parse(await response.json()).data;
    const published = await browserWrite(
      page,
      endpoint + '/actions/publish',
      { reason: '公开受控长文本样本', confirmed: true },
      'POST',
      { 'If-Match': guideEtag('maibot', edited.revision), 'Idempotency-Key': randomUUID() },
    );
    expect(published.status()).toBe(200);
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
      for (const target of [page, guest]) await target.setViewportSize({ width, height });
      await page.goto('/admin/guides');
      const opener = page.getByRole('button', { name: '编辑指南：' + title, exact: true });
      await expect(opener).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: join(directory, width + 'x' + height + '-management.png') });
      const openerHeight = (await opener.boundingBox())?.height;
      expect(openerHeight).toBeGreaterThanOrEqual(44);
      await opener.click();
      const panel = page.getByRole('dialog', { name: '编辑指南', exact: true });
      await expect(page.getByLabel('指南标题', { exact: true })).toHaveValue(title);
      if (width < 1024) {
        const tab = page.getByRole('tab', { name: '查看预览', exact: true });
        expect((await tab.boundingBox())?.height).toBeGreaterThanOrEqual(44);
        await tab.click();
        await expect(page.getByRole('region', { name: '编辑稿正文预览' })).toContainText(longWord);
        await page.getByRole('tab', { name: '编辑正文', exact: true }).click();
      }
      expect(
        await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
      await page.screenshot({ path: join(directory, width + 'x' + height + '-editor.png') });
      await page.keyboard.press('Escape');
      await expect(panel).not.toBeVisible();
      await expect(opener).toBeFocused();
      await guest.goto('/guides/maibot');
      await expect(
        guest.getByRole('heading', { level: 1, name: title, exact: true }),
      ).toBeVisible();
      await expect(guest.getByRole('heading', { level: 1 })).toHaveCount(1);
      const back = await guest
        .getByRole('link', { name: '返回指南目录', exact: true })
        .boundingBox();
      expect(back?.width).toBeLessThan(width - 32);
      expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await guest.evaluate(() => document.fonts.ready);
      const code = guest.getByRole('region', { name: '代码示例', exact: true });
      await code.focus();
      await expect(code).toBeFocused();
      await guest.keyboard.press('ArrowRight');
      await expect.poll(() => code.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      await guest
        .getByRole('heading', { level: 1, name: title, exact: true })
        .scrollIntoViewIfNeeded();
      await guest.screenshot({ path: join(directory, width + 'x' + height + '-article.png') });
      measurements.push({
        width,
        height,
        rootOverflow: false,
        panelOverflow: false,
        focusReturned: true,
        minimumButtonHeight: openerHeight,
      });
    }
    const viewport =
      info.project.name === 'desktop'
        ? { width: 1440, height: 900 }
        : info.project.name === 'mobile'
          ? { width: 390, height: 844 }
          : { width: 768, height: 1024 };
    for (const target of [page, guest]) {
      await target.setViewportSize(viewport);
      await selectTheme(target, 'dark');
      await target.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
    }
    await page.goto('/admin/guides?guide=maibot');
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await page.getByLabel('处理理由', { exact: true }).fill('大字模式下确认撤回，暂不提交');
    await page.getByRole('button', { name: '撤回指南', exact: true }).click();
    const confirmation = page.getByRole('alertdialog', { name: '撤回公开指南', exact: true });
    for (const name of ['返回编辑', '确认撤回'])
      await expect(confirmation.getByRole('button', { name, exact: true })).toBeInViewport({
        ratio: 1,
      });
    await expect(
      confirmation.getByRole('heading', { name: '撤回公开指南', exact: true }),
    ).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: join(directory, 'dark-large-confirmation.png') });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '撤回指南', exact: true })).toBeFocused();
    expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await guest.screenshot({ path: join(directory, 'dark-large-article.png') });
    for (const target of [page, guest])
      await target.evaluate(() => {
        document.documentElement.style.fontSize = '';
      });
    await page.setViewportSize({ width: 390, height: 480 });
    const reason = page.getByLabel('处理理由', { exact: true });
    await reason.focus();
    await reason.scrollIntoViewIfNeeded();
    const bounds = await reason.boundingBox();
    expect(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 480).toBe(true);
    await page.screenshot({ path: join(directory, 'limited-height-input.png') });
    await page.getByLabel('指南标题', { exact: true }).fill('提交期间保留的输入');
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**' + endpoint, async (route) => {
      if (route.request().method() === 'PATCH') await pending;
      await route.continue();
    });
    const saved = page.waitForResponse(
      (response) => response.url().endsWith(endpoint) && response.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: '保存编辑稿', exact: true }).click();
    await expect(page.getByRole('button', { name: '正在处理…', exact: true })).toBeDisabled();
    await expect(page.getByLabel('指南标题', { exact: true })).toBeDisabled();
    if (!release) throw new Error('未建立保存等待');
    release();
    release = undefined;
    expect((await saved).status()).toBe(200);
    expect(errors).toEqual([]);
    await writeFile(
      join(directory, 'measurements.json'),
      JSON.stringify(
        {
          measurements,
          scope:
            'Chromium emulation, 200% root font, reduced available height; no physical phone or system keyboard',
        },
        null,
        2,
      ),
    );
  } finally {
    release?.();
    await authorContext.close();
    await guestContext.close();
  }
});
