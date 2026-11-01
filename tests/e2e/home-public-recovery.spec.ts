import { selectTheme } from '../fixtures/theme.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { PublicStatisticsResponseSchema } from '@personamarket/contracts';

test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });

test('首页读取失败保留真实统计与介绍，恢复后回到页面自动读取且错误提示消失', async ({
  page,
}, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install();
  await page.goto('/');
  await expect(page.getByRole('button', { name: /刷新社区统计|刷新站点介绍/ })).toHaveCount(0);
  const initial = PublicStatisticsResponseSchema.parse(
    await (await page.request.get('/api/v1/public/statistics')).json(),
  );
  const title = await page.getByRole('heading', { level: 1 }).innerText();
  await expect(page.getByTestId('stat-personas')).toHaveText(
    new Intl.NumberFormat('zh-CN').format(initial.data.personas),
  );
  const size = page.viewportSize();
  if (!size) throw new Error('缺少浏览器视口');
  const phase = process.env['DESIGN_CAPTURE_PHASE'] === 'before' ? 'before' : 'current';
  const directory = join(
    'data/tests/home-recovery',
    phase,
    `${size.width}x${size.height}`,
    randomUUID(),
  );
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('img.home-hero-art')).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('img.home-hero-art')
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.screenshot({ path: join(directory, 'home-top.png') });
  const aborted = new Map<string, number>();
  const paths = ['/api/v1/public/statistics', '/api/v1/public/config'];
  const pattern = '**/api/v1/public/**';
  await page.route(pattern, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'GET' && paths.includes(path)) {
      aborted.set(path, (aborted.get(path) ?? 0) + 1);
      return route.abort('failed');
    }
    return route.continue();
  });
  // 跨过既有30秒新鲜期后模拟断网重连，不为测试恢复多余的页面按钮
  await expect(
    page
      .getByRole('navigation', { name: '账号导航', exact: true })
      .getByRole('link', { name: '登录', exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(31_000);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const statisticsError = page.getByText('社区统计暂时无法更新，显示上次读取的数据', {
    exact: true,
  });
  const configError = page.getByText('站点介绍暂时无法更新，当前内容已保留', {
    exact: true,
  });
  await expect(statisticsError).toBeVisible();
  await expect(configError).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
  await expect(page.getByTestId('stat-personas')).toHaveText(
    new Intl.NumberFormat('zh-CN').format(initial.data.personas),
  );
  for (const path of paths) expect(aborted.get(path) ?? 0).toBeLessThanOrEqual(2);
  await page.screenshot({ path: join(directory, 'read-failed.png'), fullPage: true });
  await page.unroute(pattern);
  const recovered = new Set<string>();
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (response.status() === 200 && paths.includes(path)) recovered.add(path);
  });
  // 浏览器仿真发送回到可见页面的事件，身份与数据仍由真实API提供
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect(statisticsError).toHaveCount(0);
  await expect(configError).toHaveCount(0);
  expect([...recovered].sort()).toEqual([...paths].sort());
  await expect(page.getByTestId('stat-personas')).toHaveText(
    new Intl.NumberFormat('zh-CN').format(initial.data.personas),
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
  const screenshot = join(directory, 'recovered.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  const measurements: unknown[] = [];
  const viewports =
    info.project.name === 'desktop'
      ? [
          { width: 360, height: 800 },
          { width: 430, height: 932 },
          { width: 768, height: 1024 },
          { width: 944, height: 900 },
          { width: 960, height: 768 },
          { width: 1024, height: 768 },
          { width: 1366, height: 768 },
          { width: 1920, height: 1080 },
        ]
      : [];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => scrollTo(0, 0));
    await expect
      .poll(() =>
        page
          .locator('img.home-hero-art')
          .evaluate(
            (image) =>
              (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
          ),
      )
      .toBe(true);
    const measurement = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      heroHeight: document.querySelector('[aria-label="站点介绍"]')?.getBoundingClientRect().height,
    }));
    expect(measurement.scrollWidth).toBeLessThanOrEqual(measurement.width);
    measurements.push(measurement);
    await page.screenshot({ path: join(directory, `home-${viewport.width}.png`) });
  }
  await page.setViewportSize(size);
  await page.evaluate(() => scrollTo(0, 0));
  await selectTheme(page, 'dark');
  await page.screenshot({ path: join(directory, 'home-dark.png') });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: join(directory, 'home-large-type.png') });
  const platformTop = await page
    .getByRole('heading', { name: '选择你的平台', exact: true })
    .evaluate((heading) => {
      const card = heading.closest('[data-slot="card"]');
      if (!card) throw new Error('平台面板不存在');
      return card.getBoundingClientRect().top + scrollY;
    });
  await page.evaluate((top) => scrollTo(0, Math.max(0, top - 80)), platformTop);
  await page.screenshot({ path: join(directory, 'platform-large-type.png') });
  const clipped = await page.locator('#main a, #main h3[translate="no"]').evaluateAll((elements) =>
    elements.flatMap((element) => {
      const box = element.getBoundingClientRect();
      const card = element.closest('[data-slot="card"]')?.getBoundingClientRect();
      if (
        element.scrollWidth > element.clientWidth + 1 ||
        (card && (box.left < card.left - 1 || box.right > card.right + 1))
      )
        return [
          {
            label: element.textContent,
            width: element.clientWidth,
            contentWidth: element.scrollWidth,
          },
        ];
      return [];
    }),
  );
  expect(clipped, '大字号下的链接和平台名称不能被卡片裁切').toEqual([]);
  await writeFile(join(directory, 'layout.json'), JSON.stringify(measurements, null, 2));
  await info.attach('homepage-public-data-recovered', {
    path: screenshot,
    contentType: 'image/png',
  });
});
