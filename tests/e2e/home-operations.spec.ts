import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { browserWrite, loginCreator } from '../fixtures/browser-account.js';
import { visualPersonas } from '../fixtures/visual-personas.js';
import {
  AdminPersonaResponseSchema,
  AdminAnnouncementResponseSchema,
  HomeSettingsResponseSchema,
  homeSettingsEtag,
  announcementEtag,
} from '@personamarket/contracts';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });
test('首页运营设置可核对模块和导航，保存后由公开页面读取真实配置', async ({
  page,
  browser,
}, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  const phase = process.env['HOME_OPERATIONS_CAPTURE_PHASE'] === 'before' ? 'before' : 'after';
  const directory = join('data/tests/home-operations', phase, info.project.name, randomUUID());
  await mkdir(directory, { recursive: true });
  await loginBrowserAdmin(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images]
        .filter((image) => image.loading !== 'lazy')
        .map((image) => image.decode().catch(() => undefined)),
    );
  });
  await page.screenshot({ path: join(directory, 'home.png') });
  const response = await page.goto('/admin/settings/home');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  if (phase === 'after') await page.getByLabel('首页短提示', { exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(directory, 'settings.png') });
  await writeFile(
    join(directory, 'response.json'),
    JSON.stringify({ status: response?.status(), width: page.viewportSize()?.width }, null, 2),
  );
  await expect(page.getByRole('heading', { name: '首页展示', exact: true })).toBeVisible();
  const baseURL = process.env['PLAYWRIGHT_ORIGIN'];
  if (!baseURL) throw new Error('必须使用隔离测试站点');
  const authorContext = await browser.newContext({ baseURL });
  const readerContext = await browser.newContext({ baseURL, viewport: page.viewportSize() });
  try {
    const author = await authorContext.newPage(),
      reader = await readerContext.newPage();
    await loginCreator(author);
    const works = await visualPersonas(author, page);
    for (const work of [works.maibot, works.astrbot]) {
      const path = '/api/v1/admin/personas/' + work.id;
      const current = AdminPersonaResponseSchema.parse(
        await (await page.request.get(path)).json(),
      ).data;
      expect(
        (
          await browserWrite(
            page,
            path + '/curation',
            {
              featured: true,
              official: false,
              expectedRevision: current.revision,
              reason: '核对首页数量设置',
            },
            'PUT',
            { 'Idempotency-Key': randomUUID() },
          )
        ).status(),
      ).toBe(200);
    }
    for (const number of [1, 2]) {
      const created = await browserWrite(
        page,
        '/api/v1/admin/announcements',
        {
          title: '首页运营公告-' + number,
          summary: '验证首页数量上限',
          body: '真实保存并确认发布的站点消息',
          pinned: false,
          reason: '准备真实公开消息',
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      );
      expect(created.status()).toBe(200);
      const row = AdminAnnouncementResponseSchema.parse(await created.json()).data;
      expect(
        (
          await browserWrite(
            page,
            '/api/v1/admin/announcements/' + row.id + '/publish',
            { reason: '核对公开状态', confirmed: true },
            'POST',
            { 'Idempotency-Key': randomUUID(), 'If-Match': announcementEtag(row.id, row.revision) },
          )
        ).status(),
      ).toBe(200);
    }
    await page.getByLabel('首页短提示', { exact: true }).fill('一起分享真实的角色灵感');
    for (const label of ['精选展示数量', '新作展示数量', '公告展示数量'])
      await page.getByLabel(label, { exact: true }).fill('1');
    await page.getByRole('switch', { name: '展示创作入口', exact: true }).click();
    await page.getByRole('button', { name: '站点公告上移', exact: true }).click();
    await page.getByRole('button', { name: '站点公告上移', exact: true }).click();
    await page.getByRole('checkbox', { name: '发布作品', exact: true }).uncheck();
    await page.getByRole('checkbox', { name: '人设排行', exact: true }).uncheck();
    await page.getByRole('button', { name: '站点公告导航上移', exact: true }).click();
    const endpoint = '**/api/v1/admin/settings/home';
    let blockedKey = '';
    await page.route(endpoint, (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      blockedKey = route.request().headers()['idempotency-key'] ?? '';
      return route.abort('failed');
    });
    await page.getByRole('button', { name: '保存首页设置', exact: true }).click();
    await expect(
      page.getByRole('group', { name: '首页展示设置表单', exact: true }).getByRole('alert'),
    ).toContainText('暂时');
    await expect(page.getByLabel('首页短提示', { exact: true })).toHaveValue(
      '一起分享真实的角色灵感',
    );
    await page.unroute(endpoint);
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/admin/settings/home') && response.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: '保存首页设置', exact: true }).click();
    const savedResponse = await saved;
    expect(savedResponse.status()).toBe(200);
    expect(savedResponse.request().headers()['idempotency-key']).toBe(blockedKey);
    await expect(
      page.getByText('首页设置已保存，公开页面将在重新加载时使用新配置', { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: join(directory, 'updated-settings.png') });
    await reader.goto('/');
    await expect(reader.getByText('一起分享真实的角色灵感', { exact: true })).toBeVisible();
    expect(
      await reader
        .locator('[data-home-section]')
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('data-home-section')),
        ),
    ).toEqual(['announcements', 'featured', 'recent']);
    for (const region of ['精选人设', '新近发布']) {
      const section = reader.getByRole('region', { name: region, exact: true });
      expect(
        (await section.getByRole('link', { name: works.maibot.title }).count()) +
          (await section.getByRole('link', { name: works.astrbot.title }).count()),
      ).toBe(1);
    }
    await expect(
      reader
        .getByRole('region', { name: '站点公告', exact: true })
        .getByRole('link', { name: /^首页运营公告-/ }),
    ).toHaveCount(1);
    const compact = (reader.viewportSize()?.width ?? 390) < 1024;
    if (compact) await reader.getByRole('button', { name: '打开导航', exact: true }).click();
    const navigation = reader.getByRole('navigation', {
      name: compact ? '移动端主导航' : '主导航',
      exact: true,
    });
    expect(await navigation.getByRole('link').allTextContents()).toEqual([
      '首页',
      '探索',
      '公告',
      '文档',
    ]);
    if (compact) await reader.keyboard.press('Escape');
    expect(
      (
        await browserWrite(author, '/api/v1/me/personas', {
          platform: 'maibot',
          title: '导航收起后仍可保存草稿',
        })
      ).status(),
    ).toBe(200);
    await reader.evaluate(() => document.fonts.ready);
    await reader.screenshot({ path: join(directory, 'updated-home.png') });
    const preview = page.getByRole('button', { name: '预览默认设置', exact: true });
    await preview.click();
    const dialog = page.getByRole('alertdialog', { name: '预览首页默认设置', exact: true });
    await expect(dialog.getByText('一起分享真实的角色灵感', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: '保留当前输入', exact: true }).click();
    await expect(page.getByLabel('精选展示数量', { exact: true })).toHaveValue('1');
    await preview.click();
    await dialog.getByRole('button', { name: '填入默认值', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByLabel('精选展示数量', { exact: true })).toHaveValue('4');
    expect(
      HomeSettingsResponseSchema.parse(
        await (await page.request.get('/api/v1/admin/settings/home')).json(),
      ).data.featuredCount,
    ).toBe(1);
    await expect(page.getByRole('button', { name: '保存首页设置', exact: true })).toBeEnabled();
    const restored = page.waitForResponse(
      (response) =>
        response.url().endsWith('/admin/settings/home') && response.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: '保存首页设置', exact: true }).click();
    expect((await restored).status()).toBe(200);
    await reader.reload();
    await expect(reader.locator('[data-home-section="creation"]')).toBeVisible();
    expect(await reader.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await expect(page.getByRole('heading', { name: '首页修改记录', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '查看修改差异', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: '修改前', exact: true })).toBeVisible();
  } finally {
    await authorContext.close();
    await readerContext.close();
  }
});

test('首页同字段冲突保留输入后可重新保存，停留六分钟后返回仍保留当前账号输入', async ({ page }) => {
  await loginBrowserAdmin(page);
  await page.goto('/admin/settings/home');
  await page.getByLabel('首页短提示', { exact: true }).waitFor();
  const current = HomeSettingsResponseSchema.parse(
    await (await page.request.get('/api/v1/admin/settings/home')).json(),
  );
  await page.clock.install();
  await page.getByLabel('首页短提示', { exact: true }).fill('当前窗口保留的创作文字');
  expect(
    (
      await browserWrite(
        page,
        '/api/v1/admin/settings/home',
        {
          data: { ...current.data, heroNote: '另一窗口先保存的首页文字', announcementCount: 2 },
          reason: '另一窗口先修改',
        },
        'PATCH',
        { 'If-Match': homeSettingsEtag(current.meta.revision), 'Idempotency-Key': randomUUID() },
      )
    ).status(),
  ).toBe(200);
  const conflict = page.waitForResponse(
    (response) =>
      response.url().endsWith('/admin/settings/home') && response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: '保存首页设置', exact: true }).click();
  expect((await conflict).status()).toBe(412);
  await expect(page.getByLabel('首页短提示', { exact: true })).toHaveValue(
    '当前窗口保留的创作文字',
  );
  await expect(page.getByText(/其他管理员同时修改了相同设置/u)).toBeVisible();
  await expect(page.getByLabel('首页短提示', { exact: true })).toHaveValue(
    '当前窗口保留的创作文字',
  );
  await expect(page.getByLabel('公告展示数量', { exact: true })).toHaveValue('2');
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/admin/settings/home') && response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: '保存首页设置', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await page.getByLabel('首页短提示', { exact: true }).fill('浏览器返回后仍保留的文字');
  await expect(page.getByText('有未保存的首页设置', { exact: true })).toBeVisible();
  await page.clock.fastForward('06:00');
  if (await page.getByRole('button', { name: '选择设置分组', exact: true }).isVisible())
    await page.getByRole('button', { name: '选择设置分组', exact: true }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('link', { name: '站点品牌', exact: true }).click();
  await page.waitForURL(/\/admin\/settings\/brand$/);
  await page.goBack();
  await expect(page.getByLabel('首页短提示', { exact: true })).toHaveValue(
    '浏览器返回后仍保留的文字',
  );
});

test('网络保存失败后可重新保存，成功状态清理先前的错误', async ({ page }) => {
  await loginBrowserAdmin(page);
  await page.goto('/admin/settings/home');
  await page.getByLabel('首页短提示', { exact: true }).waitFor();
  const endpoint = '**/api/v1/admin/settings/home';
  await page.route(endpoint, (route) =>
    route.request().method() === 'PATCH' ? route.abort('failed') : route.continue(),
  );
  await page.getByLabel('首页短提示', { exact: true }).fill('保存失败后保留的输入');
  await page.getByRole('button', { name: '保存首页设置', exact: true }).click();
  const failure = page.getByText('暂时无法确认保存结果，请再次点击保存。', { exact: true });
  await expect(failure).toBeVisible();
  await page.unroute(endpoint);
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/admin/settings/home') && response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: '保存首页设置', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(
    page.getByText('首页设置已保存，公开页面将在重新加载时使用新配置', { exact: true }),
  ).toBeVisible();
  await expect(failure).toHaveCount(0);
});
