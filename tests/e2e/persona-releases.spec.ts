import { selectExploreFilter } from '../fixtures/explore-filters.js';
import { expect, test } from '@playwright/test';
import { SubmissionListResponseSchema, DraftResponseSchema } from '@personamarket/contracts';
import { readFile } from 'node:fs/promises';
import { parseMaiBot, parseAstrBot } from '@personamarket/persona-adapters';
import { randomUUID } from 'node:crypto';
import { loginCreator, browserWrite } from '../fixtures/browser-account.js';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
test.use({ trace: 'off', screenshot: 'off', actionTimeout: 10000 });
test('真实编辑器发版、审核差异与驳回重提、公开详情和作者隐藏', async ({ page, browser }, info) => {
  test.setTimeout(120000);
  const selectFilter = async (label: string, option: string) => {
    const previousUrl = page.url();
    await selectExploreFilter(page, label, option);
    await expect(page).not.toHaveURL(previousUrl);
    await expect(page.locator('fieldset[aria-busy]')).toHaveAttribute('aria-busy', 'false');
  };
  await loginCreator(page);
  const adminContext = await browser.newContext({
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    viewport: page.viewportSize() ?? { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  try {
    const admin = await adminContext.newPage();
    await loginBrowserAdmin(admin);
    const publish = async (version: string) => {
      await page.getByRole('button', { name: '创建 Release', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '确认本次发版', exact: true });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('版本号', { exact: true }).fill(version);
      await dialog.getByLabel('更新日志', { exact: true }).fill('完善故事与使用说明');
      await dialog
        .getByRole('checkbox', {
          name: '我已核对公开内容、版本号及来源许可，确认提交审核',
          exact: true,
        })
        .check();
      await dialog.getByRole('button', { name: '确认提交审核', exact: true }).click();
      await expect(dialog).toBeHidden();
    };
    for (const platform of ['MaiBot', 'AstrBot']) {
      await page.goto('/dashboard/personas/new');
      await page.getByRole('button', { name: platform, exact: true }).click();
      await page.getByLabel('人设名称', { exact: true }).fill(platform + ' 林间向导');
      await page.getByRole('button', { name: '创建私有草稿', exact: true }).click();
      await expect(page).toHaveURL(/\/edit$/);
      const id = page.url().split('/').at(-2);
      if (!id) throw new Error('缺少人设 ID');
      await page.getByLabel('一句话简介', { exact: true }).fill('跟着云鸭认识林间的故事');
      await page.getByRole('combobox', { name: '主要分类', exact: true }).click();
      await page
        .getByRole('option', { name: platform === 'MaiBot' ? '陪伴聊天' : '角色扮演', exact: true })
        .click();
      await page.getByLabel('作品标签', { exact: true }).fill('温柔治愈');
      await page
        .getByRole('group', { name: '推荐标签', exact: true })
        .getByRole('button', { name: '温柔治愈', exact: true })
        .click();
      await page.getByRole('button', { name: '添加推荐模型', exact: true }).click();
      await page.getByLabel('模型 1 · 标识', { exact: true }).fill(platform + '-测试模型');
      await page.getByLabel('人格设定', { exact: true }).fill('  喜欢自然、文学与慢生活  ');
      if (platform === 'MaiBot') {
        await page.getByLabel('表达风格', { exact: true }).fill('亲切而简洁');
        await page.getByLabel('行为风格', { exact: true }).fill('耐心倾听，尊重他人');
      } else {
        await page.getByRole('button', { name: '添加一对对话', exact: true }).click();
        await page.getByLabel('对话 1 · 用户', { exact: true }).fill('今天去哪里');
        await page.getByLabel('对话 1 · AI', { exact: true }).fill('一起去林间走走吧');
      }
      await page
        .getByRole('textbox', { name: 'Markdown 介绍', exact: true })
        .fill('# 林间的故事\n\n欢迎认识这个角色');
      await page
        .getByRole('checkbox', {
          name: '我确认有权提交这些内容，并授权站点按本页声明展示和提供复制下载',
          exact: true,
        })
        .check();
      await page.getByRole('button', { name: '创建 Release', exact: true }).click();
      const sheet = page.getByRole('dialog', { name: '确认本次发版', exact: true });
      await expect(sheet).toBeVisible();
      await sheet.getByLabel('版本号', { exact: true }).fill('1.0.0');
      await expect(sheet.getByLabel('更新日志', { exact: true })).toHaveValue('');
      await sheet
        .getByRole('checkbox', {
          name: '我已核对公开内容、版本号及来源许可，确认提交审核',
          exact: true,
        })
        .check();
      await sheet.getByRole('button', { name: '确认提交审核', exact: true }).click();
      await expect(sheet).toBeHidden();
      const submissions = SubmissionListResponseSchema.parse(
        await (await page.request.get('/api/v1/me/personas/' + id + '/releases')).json(),
      );
      const submission = submissions.data[0];
      if (!submission) throw new Error('缺少真实提交');
      expect(submission.changelog).toBe('');
      expect((await page.request.get('/api/v1/personas/' + id)).status()).toBe(404);
      await admin.goto('/admin/moderation?submission=' + submission.id);
      await admin.getByRole('tab', { name: '版本差异', exact: true }).click();
      await expect(admin.getByText('首次发布，以下为新增内容', { exact: true })).toBeVisible();
      await admin.getByLabel('审核意见', { exact: true }).fill('已核验正文、来源与授权');
      await admin.getByRole('button', { name: '通过并发布', exact: true }).last().click();
      await expect(admin.getByRole('heading', { name: '审核决定', exact: true })).toHaveCount(0);
      await page.goto('/personas/' + id);
      await expect(
        page.getByRole('heading', { name: platform + ' 林间向导', exact: true }),
      ).toBeVisible();
      await page.getByRole('tab', { name: '人设内容', exact: true }).click();
      await expect(
        page
          .getByRole('tabpanel', { name: '人设内容', exact: true })
          .getByText('  喜欢自然、文学与慢生活  ', { exact: true }),
      ).toBeVisible();
      if (platform === 'AstrBot')
        await expect(
          page
            .getByRole('tabpanel', { name: '人设内容', exact: true })
            .getByText('AI：一起去林间走走吧', { exact: true }),
        ).toBeVisible();
      await page.getByRole('button', { name: '复制人格设定', exact: true }).click();
      await expect(
        page
          .getByRole('button', { name: '已复制', exact: true })
          .or(page.getByRole('dialog', { name: '选择并复制文本', exact: true })),
      ).toBeVisible();
      const fallback = page.getByRole('dialog', { name: '选择并复制文本', exact: true });
      if (await fallback.isVisible()) {
        await expect(
          fallback.getByRole('textbox', { name: '待复制内容', exact: true }),
        ).toHaveValue('  喜欢自然、文学与慢生活  ');
        await page.keyboard.press('Escape');
      }
      await page.getByRole('button', { name: '导出', exact: true }).click();
      const exportSheet = page.getByRole('dialog', { name: '导出这个版本', exact: true });
      await expect(
        exportSheet.getByRole('textbox', { name: '导出内容预览', exact: true }),
      ).toBeVisible();
      const downloading = page.waitForEvent('download');
      await exportSheet.getByRole('button', { name: '下载文件', exact: true }).click();
      const download = await downloading;
      const file = await download.path();
      if (!file) throw new Error('缺少真实导出文件');
      const bytes = await readFile(file);
      const native = platform === 'MaiBot' ? parseMaiBot(bytes) : parseAstrBot(bytes, randomUUID);
      expect(native.persona.platform).toBe(platform === 'MaiBot' ? 'maibot' : 'astrbot');
      expect(native.persona.content).toMatchObject(
        platform === 'MaiBot'
          ? {
              personality: '  喜欢自然、文学与慢生活  ',
              replyStyle: '亲切而简洁',
              behaviorStyle: '耐心倾听，尊重他人',
            }
          : {
              systemPrompt: '  喜欢自然、文学与慢生活  ',
              dialoguePairs: [{ user: '今天去哪里', assistant: '一起去林间走走吧' }],
            },
      );
      await page.keyboard.press('Escape');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: info.outputPath(platform + '-published.png'), fullPage: true });
      if (platform === 'MaiBot') {
        await page.goto('/dashboard/personas/' + id + '/edit');
        await page.getByLabel('一句话简介', { exact: true }).fill('新的故事仍等待审核');
        await publish('1.1.0');
        const pending = SubmissionListResponseSchema.parse(
          await (await page.request.get('/api/v1/me/personas/' + id + '/releases')).json(),
        ).data[0];
        if (!pending) throw new Error('缺少更新提交');
        await admin.goto('/admin/moderation?submission=' + pending.id);
        await admin.getByRole('button', { name: '驳回修改', exact: true }).click();
        await admin.getByLabel('审核意见（必填）', { exact: true }).fill('请补充作者使用建议');
        await admin.getByRole('button', { name: '驳回并通知作者', exact: true }).click();
        await expect(admin.getByRole('heading', { name: '审核决定', exact: true })).toHaveCount(0);
        await page.goto('/dashboard/personas/' + id + '/releases');
        await expect(
          page.getByText('审核或操作意见：请补充作者使用建议', { exact: true }),
        ).toBeVisible();
        await page.getByRole('button', { name: '复制为当前草稿', exact: true }).first().click();
        const restoreDraft = page.getByRole('dialog', { name: '用版本快照替换草稿', exact: true });
        await expect(restoreDraft.getByText(/当前草稿版本/)).toBeVisible();
        const current = DraftResponseSchema.parse(
          await (await page.request.get('/api/v1/me/personas/' + id + '/draft')).json(),
        );
        expect(
          (
            await browserWrite(
              page,
              '/api/v1/me/personas/' + id + '/draft',
              { ...current.data.draft, authorNotes: '另一个页面的新修改' },
              'PUT',
              { 'If-Match': '"draft-' + current.meta.revision + '"' },
            )
          ).status(),
        ).toBe(200);
        await restoreDraft.getByRole('button', { name: '确认覆盖草稿', exact: true }).click();
        await expect(
          restoreDraft.getByText('当前草稿已变化，请备份编辑后重新确认', { exact: true }),
        ).toBeVisible();
        await page.keyboard.press('Escape');
        await page.getByRole('link', { name: '继续编辑与发版', exact: true }).click();
        await page.getByLabel('作者使用说明', { exact: true }).fill('建议在轻松日常对话中使用');
        await publish('1.1.0');
        const retry = SubmissionListResponseSchema.parse(
          await (await page.request.get('/api/v1/me/personas/' + id + '/releases')).json(),
        ).data[0];
        if (!retry) throw new Error('缺少重提快照');
        expect(retry.attemptNumber).toBe(2);
        await admin.goto('/admin/moderation?submission=' + retry.id);
        await admin.getByLabel('审核意见', { exact: true }).fill('已补齐建议');
        await admin.getByRole('button', { name: '通过并发布', exact: true }).last().click();
        await expect(admin.getByRole('heading', { name: '审核决定', exact: true })).toHaveCount(0);
      }
      await page.goto('/dashboard/personas/' + id + '/releases');
      await page.getByRole('button', { name: '隐藏作品', exact: true }).click();
      const hide = page.getByRole('dialog', { name: '隐藏作品', exact: true });
      await expect(hide.getByLabel('操作理由', { exact: true })).toHaveCount(0);
      await hide.getByRole('button', { name: '确认隐藏作品', exact: true }).click();
      await expect(hide).toBeHidden();
      expect((await page.request.get('/api/v1/personas/' + id)).status()).toBe(404);
      await page.getByRole('button', { name: '恢复展示', exact: true }).click();
      const restore = page.getByRole('dialog', { name: '恢复展示', exact: true });
      await expect(restore.getByLabel('操作理由', { exact: true })).toHaveCount(0);
      await restore.getByRole('button', { name: '确认恢复展示', exact: true }).click();
      await expect(restore).toBeHidden();
      expect((await page.request.get('/api/v1/personas/' + id)).status()).toBe(200);
    }
    await admin.goto('/admin/settings/creation');
    await admin.getByLabel('每人每日投稿次数', { exact: true }).fill('15');
    await admin.getByLabel('处理理由', { exact: true }).fill('核对创作者流程后调整每日投稿次数');
    await admin.getByRole('button', { name: '保存创作设置', exact: true }).click();
    const confirmCreation = admin.getByRole('alertdialog', {
      name: '确认保存创作设置',
      exact: true,
    });
    await expect(confirmCreation).toBeVisible();
    await confirmCreation.getByRole('button', { name: '确认并保存', exact: true }).click();
    await expect(confirmCreation).toBeHidden();
    await expect(
      admin.getByText('创作设置已保存，待审版本在重新读取时使用当前提示', { exact: true }),
    ).toBeVisible();
    await admin.reload();
    await expect(admin.getByLabel('每人每日投稿次数', { exact: true })).toHaveValue('15');
    await admin.screenshot({ path: info.outputPath('creation-settings.png'), fullPage: true });
    await page.goto('/explore?platform=maibot&q=' + encodeURIComponent('林间'));
    await expect(page.getByRole('link').filter({ hasText: 'MaiBot 林间向导' })).toHaveCount(1);
    await expect(page.getByRole('link').filter({ hasText: 'AstrBot 林间向导' })).toHaveCount(0);
    await page
      .getByRole('group', { name: '人设平台', exact: true })
      .getByRole('button', { name: '全部', exact: true })
      .click();
    await expect(page).not.toHaveURL(/platform=/);
    await expect(page.getByRole('link').filter({ hasText: 'AstrBot 林间向导' })).toHaveCount(1);
    await selectFilter('分类', '陪伴聊天');
    await expect(page).toHaveURL(/categoryId=/);
    await expect(page.getByRole('link').filter({ hasText: 'AstrBot 林间向导' })).toHaveCount(0);
    await selectFilter('标签 / 风格', '温柔治愈');
    await selectFilter('推荐模型', 'MaiBot-测试模型');
    await selectFilter('作品来源', '原创作品');
    await selectFilter('转载规则', '联系作者');
    await page.getByRole('button', { name: '列表视图', exact: true }).click();
    await page.getByRole('combobox', { name: '结果排序', exact: true }).click();
    await page.getByRole('option', { name: '最早发布', exact: true }).click();
    await expect(page).toHaveURL(/sort=oldest/);
    await page.reload();
    for (const key of [
      'categoryId=',
      'tagIds=',
      'model=',
      'origin=original',
      'redistribution=contact_required',
      'view=list',
      'sort=oldest',
    ])
      expect(page.url()).toContain(key);
    await expect(page.getByRole('link').filter({ hasText: 'MaiBot 林间向导' })).toHaveCount(1);
    await expect(page.getByRole('heading', { name: '本页创作者', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '创作小贴士', exact: true })).toHaveCount(0);
    await selectFilter('作品来源', '转载作品');
    await expect(page.getByText('没有找到匹配的人设', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '开始创作', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '清空筛选', exact: true }).click();
    await expect(page).not.toHaveURL(/categoryId=/);
    await expect(page.locator('fieldset[aria-busy]')).toHaveAttribute('aria-busy', 'false');
    await page.screenshot({ path: info.outputPath('explore-published.png'), fullPage: true });
    await page.goto('/');
    await expect(page.getByRole('link').filter({ hasText: 'MaiBot 林间向导' })).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath('home-published.png'), fullPage: true });
  } finally {
    await adminContext.close();
  }
});
