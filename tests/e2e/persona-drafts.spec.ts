import { selectTheme } from '../fixtures/theme.js';
import { selectAccountNavigation } from '../fixtures/account-navigation.js';
import { expect, test } from '@playwright/test';
import { DraftResponseSchema } from '@personamarket/contracts';
import { loginCreator, browserWrite } from '../fixtures/browser-account.js';
test.use({ trace: 'off', screenshot: 'off' });
test('MaiBot 与 AstrBot 创建、自动保存、刷新、整对重排和失败恢复', async ({ page }, info) => {
  await loginCreator(page);
  await selectAccountNavigation(page, '创作工作台');
  await expect(page.getByText('为你的第一个角色写下性格', { exact: true })).toBeVisible();
  for (const platform of ['MaiBot', 'AstrBot']) {
    await page
      .getByRole('link', { name: platform === 'MaiBot' ? '开始创作' : '创建人设', exact: true })
      .click();
    await page.getByRole('button', { name: platform, exact: true }).click();
    await page.getByLabel('人设名称', { exact: true }).fill(platform + ' 真实创作');
    await page.getByRole('button', { name: '创建私有草稿', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/personas\/[a-f0-9-]+\/edit$/);
    await page.getByLabel('一句话简介', { exact: true }).fill('从真实编辑器保存到 PostgreSQL');
    await page.getByLabel('人格设定', { exact: true }).fill('  一个喜欢阅读的角色\n保留首尾空白  ');
    if (platform === 'MaiBot') {
      await page.getByLabel('表达风格', { exact: true }).fill('温和自然');
      await page.getByLabel('行为风格', { exact: true }).fill('尊重边界');
    } else {
      for (const name of ['第一对', '第二对']) {
        await page.getByRole('button', { name: '添加一对对话', exact: true }).click();
        const count = name === '第一对' ? 1 : 2;
        await page.getByLabel(`对话 ${count} · 用户`, { exact: true }).fill(name + '用户');
        await page.getByLabel(`对话 ${count} · AI`, { exact: true }).fill(name + '回应');
      }
      await page.getByRole('button', { name: '上移对话 2', exact: true }).click();
      await expect(page.getByLabel('对话 1 · 用户', { exact: true })).toHaveValue('第二对用户');
      await expect(page.getByLabel('对话 2 · AI', { exact: true })).toHaveValue('第一对回应');
    }
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page.getByText('已保存到服务器', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('人格设定', { exact: true })).toHaveValue(
      '  一个喜欢阅读的角色\n保留首尾空白  ',
    );
    const id = page.url().split('/').at(-2);
    const path = '/api/v1/me/personas/' + id + '/draft';
    const current = DraftResponseSchema.parse(await (await page.request.get(path)).json());
    await page.route('**/api/v1/me/personas/*/draft', (route) =>
      route.request().method() === 'PUT' ? route.abort() : route.continue(),
    );
    await page.getByLabel('一句话简介', { exact: true }).fill('断网时保留的本地内容');
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page.getByText('保存失败，内容仍保留在当前页面', { exact: true })).toBeVisible();
    await expect(page.getByLabel('一句话简介', { exact: true })).toHaveValue(
      '断网时保留的本地内容',
    );
    await page.unroute('**/api/v1/me/personas/*/draft');
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page.getByText('已保存到服务器', { exact: true })).toBeVisible();
    const saved = DraftResponseSchema.parse(await (await page.request.get(path)).json());
    expect(saved.meta.revision).toBeGreaterThan(current.meta.revision);
    expect(
      (
        await browserWrite(page, path, { ...saved.data.draft, title: '另一页面版本' }, 'PUT', {
          'If-Match': '"draft-' + saved.meta.revision + '"',
        })
      ).status(),
    ).toBe(200);
    await page.getByLabel('一句话简介', { exact: true }).fill('冲突内容不能被静默覆盖');
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(
      page.getByText('其他页面已保存更新，请对比服务器草稿后重试', { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('一句话简介', { exact: true })).toHaveValue(
      '冲突内容不能被静默覆盖',
    );
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '重新载入服务器草稿', exact: true }).click();
    await expect(page.getByLabel('人设名称', { exact: true })).toHaveValue('另一页面版本');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(platform + '-editor-light.png'),
      fullPage: true,
    });
    await selectTheme(page, 'dark');
    await page.screenshot({ path: info.outputPath(platform + '-editor-dark.png'), fullPage: true });
    await selectTheme(page, 'light');
    await page.getByRole('link', { name: '返回我的人设', exact: true }).click();
  }
});
