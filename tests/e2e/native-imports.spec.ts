import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { serializeMaiBot, serializeAstrBot } from '@personamarket/persona-adapters';
import { DraftResponseSchema } from '@personamarket/contracts';
import { loginCreator } from '../fixtures/browser-account.js';
test.use({ trace: 'off', screenshot: 'off' });
test('两平台原生文件真实预览、来源确认与草稿恢复', async ({ page }, info) => {
  await loginCreator(page);
  for (const platform of ['maibot', 'astrbot'] as const) {
    await page.goto('/dashboard/personas');
    await page.getByRole('link', { name: '导入人设', exact: true }).click();
    await page.getByRole('tab', { name: '平台原生文件', exact: true }).click();
    const source =
      platform === 'maibot'
        ? serializeMaiBot({
            platform,
            content: {
              personality: '  中文人格原文  ',
              replyStyle: '简洁自然',
              behaviorStyle: '尊重边界',
            },
          })
        : serializeAstrBot(
            {
              platform,
              content: {
                systemPrompt: '  中文人格原文  ',
                dialoguePairs: [{ id: randomUUID(), user: '你好', assistant: '欢迎来到林间' }],
              },
            },
            '林间旅人',
          );
    if (platform === 'astrbot')
      await page.getByRole('button', { name: 'AstrBot JSON', exact: true }).click();
    await page.getByLabel('原生人设文件', { exact: true }).setInputFiles({
      name: platform === 'maibot' ? '林间旅人.toml' : '林间旅人.json',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(source),
    });
    await page.getByRole('button', { name: '预览导入内容', exact: true }).click();
    await expect(page.getByRole('heading', { name: '确认导入', exact: true })).toBeVisible();
    await page.getByLabel('人设名称', { exact: true }).fill('导入的林间旅人');
    await page.getByLabel('文件来源说明', { exact: true }).fill('来自原作者的测试文件，待补充许可');
    await page
      .getByRole('checkbox', {
        name: '我已核对正文、忽略字段和来源，确认按上述范围导入私有草稿',
        exact: true,
      })
      .check();
    await page.getByRole('button', { name: '确认导入草稿', exact: true }).click();
    await expect(page).toHaveURL(/\/edit$/);
    await expect(page.getByLabel('人格设定', { exact: true })).toHaveValue('  中文人格原文  ');
    const id = page.url().split('/').at(-2);
    if (!id) throw new Error('缺少导入的人设');
    const draft = DraftResponseSchema.parse(
      await (await page.request.get('/api/v1/me/personas/' + id + '/draft')).json(),
    ).data.draft;
    expect(draft.platform).toBe(platform);
    expect(draft.rightsAccepted).toBe(false);
    expect(draft.origin.type).toBe('repost');
    if (platform === 'astrbot') {
      await expect(page.getByLabel('对话 1 · 用户', { exact: true })).toHaveValue('你好');
      await expect(page.getByLabel('对话 1 · AI', { exact: true })).toHaveValue('欢迎来到林间');
    }
    await page.reload();
    await expect(page.getByLabel('人格设定', { exact: true })).toHaveValue('  中文人格原文  ');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(platform + '-imported-editor.png'),
      fullPage: true,
    });
  }
});
