import { selectTheme } from '../fixtures/theme.js';
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { DraftResponseSchema } from '@personamarket/contracts';
import { loginCreator, browserWrite } from '../fixtures/browser-account.js';
test.use({ trace: 'off', screenshot: 'off' });
test('20 对对话、长中文模型与 README 的响应式和弹层滚动', async ({ page }, info) => {
  await loginCreator(page);
  const create = await browserWrite(page, '/api/v1/me/personas', {
    platform: 'astrbot',
    title: '长中文角色'.repeat(12),
  });
  expect(create.status()).toBe(200);
  const initial = DraftResponseSchema.parse(await create.json());
  const id = initial.data.id;
  const draft = {
    ...initial.data.draft,
    title: '长中文角色'.repeat(12),
    summary: '很长的一句话简介'.repeat(20),
    platform: 'astrbot',
    content: {
      systemPrompt: '  完整原文与空白\n' + '长中文人格设定'.repeat(500),
      dialoguePairs: Array.from({ length: 20 }, (_, index) => ({
        id: randomUUID(),
        user: '用户提问 ' + (index + 1) + ' ' + '很长的对话内容'.repeat(50),
        assistant: 'AI 回应 ' + (index + 1) + ' ' + '耐心地给出回答'.repeat(50),
      })),
    },
    readmeMarkdown:
      '# 长 README\n\n' +
      '中文介绍与使用场景 '.repeat(1500) +
      '\n\n```text\n' +
      'unbroken'.repeat(500) +
      '\n```',
    recommendedModels: [
      { modelId: 'VeryLongModelName-'.repeat(10), note: '中文模型说明'.repeat(50) },
    ],
    rightsAccepted: true,
  };
  expect(
    (
      await browserWrite(page, '/api/v1/me/personas/' + id + '/draft', draft, 'PUT', {
        'If-Match': '"draft-1"',
      })
    ).status(),
  ).toBe(200);
  await page.goto('/dashboard/personas/' + id + '/edit');
  await expect(page.getByLabel('对话 20 · AI', { exact: true })).toHaveValue(
    draft.content.dialoguePairs[19]?.assistant ?? '',
  );
  await expect(page.getByRole('button', { name: '添加一对对话', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: '实时预览', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await selectTheme(page, 'dark');
  const labelColors = await page.locator('label[for="draft-title"]').evaluate((label) => {
    const card = label.closest('[data-slot="card"]');
    if (!card) throw new Error('表单标签缺少卡片容器');
    return { label: getComputedStyle(label).color, card: getComputedStyle(card).color };
  });
  expect(labelColors.label, '深色模式表单标签应继承卡片前景色').toBe(labelColors.card);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('long-editor-dark.png'), fullPage: false });
  // 准备快照期间按钮禁用会失焦，真实读取完成后仍应明确返回发版入口
  let continueRead = () => {};
  const pendingRead = new Promise<void>((resolve) => {
    continueRead = resolve;
  });
  const draftPath = '**/api/v1/me/personas/' + id + '/draft';
  await page.route(draftPath, async (route) => {
    if (route.request().method() === 'GET') await pendingRead;
    await route.continue();
  });
  await page.getByRole('button', { name: '创建 Release', exact: true }).click();
  await expect(page.getByRole('button', { name: '正在准备快照…', exact: true })).toBeDisabled();
  await page.getByLabel('人设名称', { exact: true }).focus();
  continueRead();
  const dialog = page.getByRole('dialog', { name: '确认本次发版', exact: true });
  await expect(dialog).toBeVisible();
  await page.unroute(draftPath);
  await dialog.getByRole('tab', { name: '人设内容', exact: true }).click();
  await expect(dialog.getByText('第 20 组', { exact: true })).toBeAttached();
  await dialog.getByLabel('版本号', { exact: true }).fill('1.0.0');
  await expect(dialog.getByLabel('版本号', { exact: true })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: '创建 Release', exact: true })).toBeFocused();
});
