import { expect, test } from '@playwright/test';
import { selectTheme } from '../fixtures/theme.js';
import { z } from 'zod';

test.use({ trace: 'off', screenshot: 'off', reducedMotion: 'reduce' });

test('未水合时系统主题和显式偏好已决定真实表单配色，非法Cookie回到系统偏好', async ({
  browser,
}, info) => {
  const origin = process.env['PLAYWRIGHT_ORIGIN'];
  if (!origin) throw new Error('必须使用隔离测试站点');
  const observations: { expected: string; body: string; input: string; illustration: string }[] =
    [];
  for (const variant of [
    { cookie: undefined, os: 'dark', expected: 'dark' },
    { cookie: undefined, os: 'light', expected: 'light' },
    { cookie: 'tampered-theme', os: 'dark', expected: 'dark' },
    { cookie: 'system', os: 'dark', expected: 'dark' },
    { cookie: 'dark', os: 'light', expected: 'dark' },
    { cookie: 'light', os: 'dark', expected: 'light' },
  ] as const) {
    const context = await browser.newContext({
      baseURL: origin,
      javaScriptEnabled: false,
      colorScheme: variant.os,
      viewport:
        info.project.name === 'mobile'
          ? { width: 390, height: 844 }
          : info.project.name === 'tablet'
            ? { width: 768, height: 1024 }
            : { width: 1440, height: 900 },
      isMobile: info.project.name === 'mobile',
      hasTouch: info.project.name === 'mobile',
    });
    try {
      if (variant.cookie)
        await context.addCookies([{ name: 'theme', value: variant.cookie, url: origin }]);
      const page = await context.newPage();
      const response = await page.goto('/login');
      expect(response?.status()).toBe(200);
      expect(
        await page.locator('html').evaluate((element) => getComputedStyle(element).colorScheme),
      ).toBe(variant.expected);
      const body = await page
        .locator('body')
        .evaluate((element) => getComputedStyle(element).backgroundColor);
      const input = await page
        .getByLabel('用户名或邮箱', { exact: true })
        .evaluate((element) => getComputedStyle(element).backgroundColor);
      const illustration = await page
        .locator('html')
        .evaluate((element) =>
          getComputedStyle(element).getPropertyValue('--illustration-opacity'),
        );
      observations.push({ expected: variant.expected, body, input, illustration });
    } finally {
      await context.close();
    }
  }
  // 系统深色必须同时匹配根令牌和组件 dark: 变体，不能只换背景骗过验收
  for (const expected of ['light', 'dark']) {
    const group = observations.filter((item) => item.expected === expected);
    expect(
      new Set(
        group.map(({ body, input, illustration }) => JSON.stringify({ body, input, illustration })),
      ).size,
    ).toBe(1);
  }
});

test('主题菜单保存显式偏好和跟随系统，OS变化与重新加载不丢选择，切换不丢表单输入', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const scheme = () =>
    page.locator('html').evaluate((element) => getComputedStyle(element).colorScheme);
  await expect.poll(scheme).toBe('dark');
  const username = page.getByLabel('用户名或邮箱', { exact: true });
  await username.fill('theme_input_kept');
  await selectTheme(page, 'light');
  await expect.poll(scheme).toBe('light');
  await expect(username).toHaveValue('theme_input_kept');
  await expect(page.getByRole('button', { name: /^主题偏好/ })).toBeFocused();
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(scheme).toBe('light');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect.poll(scheme).toBe('light');
  await page.getByRole('button', { name: /^主题偏好/ }).click();
  await expect(page.getByRole('menuitemradio', { name: '浅色', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Escape');
  await selectTheme(page, 'system');
  await expect.poll(scheme).toBe('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(scheme).toBe('light');
  await selectTheme(page, 'dark');
  await expect.poll(scheme).toBe('dark');
  await page.reload();
  await expect.poll(scheme).toBe('dark');
  const cookie = (await page.context().cookies()).find((item) => item.name === 'theme');
  expect(cookie).toMatchObject({ value: 'dark', path: '/', sameSite: 'Lax' });
});

test('主题菜单支持键盘焦点恢复和双端大字触控布局', async ({ browser }, info) => {
  const origin = process.env['PLAYWRIGHT_ORIGIN'];
  if (!origin) throw new Error('必须使用隔离测试站点');
  const context = await browser.newContext({
    baseURL: origin,
    isMobile: info.project.name === 'mobile',
    hasTouch: info.project.name === 'mobile',
    reducedMotion: 'reduce',
  });
  try {
    const page = await context.newPage();
    const sizes =
      info.project.name === 'mobile'
        ? [
            { width: 360, height: 800 },
            { width: 390, height: 500 },
            { width: 430, height: 932 },
          ]
        : info.project.name === 'tablet'
          ? [
              { width: 768, height: 1024 },
              { width: 1024, height: 768 },
            ]
          : [
              { width: 1366, height: 768 },
              { width: 1440, height: 900 },
              { width: 1920, height: 1080 },
              { width: 960, height: 800 },
            ];
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const trigger = page.getByRole('button', { name: /^主题偏好/ });
    for (const viewport of sizes) {
      await page.setViewportSize(viewport);
      for (const large of [false, true]) {
        await page.evaluate((value) => {
          document.documentElement.style.fontSize = value ? '200%' : '';
        }, large);
        await trigger.focus();
        await page.keyboard.press('Enter');
        const menu = page.getByRole('menu', { name: '主题偏好', exact: true });
        await expect(menu).toBeVisible();
        for (const item of await menu.getByRole('menuitemradio').all()) {
          const box = await item.boundingBox();
          expect(box?.width).toBeGreaterThanOrEqual(44);
          expect(box?.height).toBeGreaterThanOrEqual(44);
        }
        const box = await menu.boundingBox();
        expect(box?.x).toBeGreaterThanOrEqual(0);
        expect((box?.x ?? 0) + (box?.width ?? Infinity)).toBeLessThanOrEqual(viewport.width);
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
          false,
        );
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();
        await expect(trigger).toBeFocused();
      }
    }
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    const system = page.getByRole('menuitemradio', { name: '跟随系统', exact: true });
    await expect(system).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitemradio', { name: '浅色', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(trigger).toBeFocused();
    if (info.project.name === 'mobile') {
      await trigger.tap();
      await page.getByRole('menuitemradio', { name: '跟随系统', exact: true }).tap();
      await expect(page.getByRole('menu', { name: '主题偏好', exact: true })).toBeHidden();
    }
  } finally {
    await context.close();
  }
});

test('首次内容绘制到水合完成保持系统深色，延迟脚本不会先显示浅色', async ({ page }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => {
    const samples: { point: string; scheme: string; background: string }[] = [];
    Reflect.set(window, '__pmThemePaintSamples', samples);
    const sample = (point: string) => {
      if (!document.body) return;
      samples.push({
        point,
        scheme: getComputedStyle(document.documentElement).colorScheme,
        background: getComputedStyle(document.body).backgroundColor,
      });
    };
    const observer = new PerformanceObserver((list) => {
      if (!list.getEntries().some((entry) => entry.name === 'first-contentful-paint')) return;
      sample('first-contentful-paint');
      requestAnimationFrame(() => sample('frame-after-fcp'));
      observer.disconnect();
    });
    observer.observe({ type: 'paint', buffered: true });
  });
  let release = () => {};
  const scriptsReady = new Promise<void>((resolve) => {
    release = resolve;
  });
  let heldScripts = 0;
  await page.route(/\/_next\/static\/.*\.js(?:\?|$)/, async (route) => {
    heldScripts++;
    await scriptsReady;
    await route.continue();
  });
  try {
    await page.goto('/login', { waitUntil: 'commit' });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const value: unknown = Reflect.get(window, '__pmThemePaintSamples');
          return Array.isArray(value) ? value.length : 0;
        }),
      )
      .toBeGreaterThan(0);
    expect(heldScripts).toBeGreaterThan(0);
    release();
    await page.waitForLoadState('load');
    await expect(page.getByLabel('用户名或邮箱', { exact: true })).toBeEnabled();
    const samples = z
      .array(z.object({ point: z.string(), scheme: z.string(), background: z.string() }))
      .parse(await page.evaluate((): unknown => Reflect.get(window, '__pmThemePaintSamples')));
    samples.push(
      await page.locator('html').evaluate((element) => ({
        point: 'hydrated',
        scheme: getComputedStyle(element).colorScheme,
        background: getComputedStyle(document.body).backgroundColor,
      })),
    );
    expect(samples.some((item) => item.point === 'first-contentful-paint')).toBe(true);
    for (const item of samples) expect(item.scheme).toBe('dark');
    expect(new Set(samples.map((item) => item.background)).size).toBe(1);
    await info.attach('theme-first-paint', {
      body: JSON.stringify({ heldScripts, samples }, null, 2),
      contentType: 'application/json',
    });
    console.log(JSON.stringify({ event: 'theme.paint.verification', heldScripts, samples }));
  } finally {
    release();
  }
});
