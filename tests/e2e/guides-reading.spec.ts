import { selectTheme } from '../fixtures/theme.js';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

test.use({ trace: 'off', screenshot: 'off' });

test('使用指南按章节阅读，目录可定位正文，正文不放创作导入操作按钮', async ({ page }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/guides');
  await expect(page.locator('h1')).toBeVisible();
  const evidence = join('data/tests/guides-reading', info.project.name, randomUUID());
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, 'guides.png'), fullPage: true });
  const article = page.getByRole('article', { name: '使用指南', exact: true });
  await expect(article).toBeVisible();
  for (const name of ['导入已有文件', '开始创作', '探索人设'])
    await expect(page.locator('main').getByRole('link', { name, exact: true })).toHaveCount(0);
  await selectTheme(page, 'dark');
  if (info.project.name !== 'desktop')
    await page.getByRole('button', { name: '打开文档目录', exact: true }).click();
  const directory = page.getByRole('navigation', { name: '文档目录', exact: true });
  await expect(directory).toBeVisible();
  const chapter = directory.getByRole('link', { name: '导入文件', exact: true });
  await chapter.focus();
  await chapter.press('Enter');
  await expect(page).toHaveURL(/\/guides#import-files$/);
  const heading = article.getByRole('heading', { name: '导入文件', exact: true });
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(
    await heading.evaluate((element) => element.getBoundingClientRect().top),
  ).toBeGreaterThanOrEqual(64);
  await expect(article).toContainText('GBK');
  await expect(article.locator('ol').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: join(evidence, 'import-dark.png') });
  await page.getByRole('contentinfo').getByRole('link', { name: '开源致谢', exact: true }).click();
  await expect(page).toHaveURL(/\/guides#credits$/);
  await expect(article.getByRole('heading', { name: '开源致谢', exact: true })).toBeInViewport();
  const project = article.getByRole('link', { name: 'shadcn/ui', exact: true });
  await expect(project).toHaveAttribute('href', 'https://ui.shadcn.com/');
  await project.focus();
  await expect(project).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: join(evidence, 'credits-dark.png') });
});

test('创作输入不提供剪贴板复制按钮，两个平台仍可编辑并按顺序组织对话', async ({ page }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dashboard/personas/new');
  const form = page.locator('#create-persona-form');
  await expect(page.getByLabel('人格设定', { exact: true })).toBeVisible();
  const evidence = join('data/tests/guides-reading', info.project.name, randomUUID());
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, 'create.png'), fullPage: true });
  await expect(form.getByRole('button', { name: /^复制/ })).toHaveCount(0);
  await page.getByLabel('人格设定', { exact: true }).fill('  保留原始正文与空白  ');
  await page.getByLabel('作者使用说明', { exact: true }).fill('创作中的说明');
  await page.getByRole('button', { name: 'AstrBot', exact: true }).click();
  await page.getByRole('button', { name: '添加一对对话', exact: true }).click();
  await page.getByLabel('对话 1 · 用户', { exact: true }).fill('你好');
  await page.getByLabel('对话 1 · AI', { exact: true }).fill('欢迎');
  await expect(form.getByRole('button', { name: /^复制/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'MaiBot', exact: true }).click();
  await expect(page.getByLabel('人格设定', { exact: true })).toHaveValue('  保留原始正文与空白  ');
  await expect(page.getByLabel('作者使用说明', { exact: true })).toHaveValue('创作中的说明');
});
