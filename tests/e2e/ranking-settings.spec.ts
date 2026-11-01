import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import {
  RankingSettingsResponseSchema,
  RankingListResponseSchema,
  defaultRankingSettings,
  rankingSettingsEtag,
} from '@personamarket/contracts';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { browserWrite } from '../fixtures/browser-account.js';
import { rankingDatabase } from '../fixtures/rankings.js';
test.use({ trace: 'off', screenshot: 'off' });
const path = '/api/v1/admin/settings/rankings';
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const messages: string[] = [];
  errors.set(page, messages);
  page.on('pageerror', (e) => messages.push(e.message));
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page) ?? []).toEqual([]);
  const response = await page.request.get(path);
  if (response.status() !== 200) return;
  const result = RankingSettingsResponseSchema.parse(await response.json());
  if (JSON.stringify(result.data) !== JSON.stringify(defaultRankingSettings))
    expect(
      (
        await browserWrite(
          page,
          path,
          { data: defaultRankingSettings, reason: '结束隔离排行设置验收' },
          'PATCH',
          {
            'If-Match': rankingSettingsEtag(result.meta.revision),
            'Idempotency-Key': randomUUID(),
          },
        )
      ).status(),
    ).toBe(200);
});
async function navigate(page: Page, name: string) {
  const entry = page.getByRole('button', { name: '选择设置分组', exact: true });
  if (await entry.isVisible()) await entry.click();
  const link = page.getByRole('link', { name, exact: true });
  const href = await link.getAttribute('href');
  if (!href) throw Error('设置入口缺少目标地址');
  const target = new URL(href, page.url()).href;
  await link.click();
  await expect(page).toHaveURL(target);
  await expect(page.getByRole('dialog', { name: '网站设置', exact: true })).toBeHidden();
}
test('跨页保留输入、默认对照、确认与焦点恢复，保存后真实批次使用新权重', async ({ page }) => {
  await loginBrowserAdmin(page);
  await page.goto('/admin/settings/rankings');
  await expect(
    page.getByRole('button', { name: '调整刷新和展示设置', exact: true }),
  ).toHaveAttribute('aria-expanded', 'false');
  await page.getByLabel('点赞权重', { exact: true }).fill('0.5');
  await page.getByLabel('处理理由', { exact: true }).fill('双端核对冻结评分配置');
  page.once('dialog', (dialog) => dialog.accept());
  await navigate(page, '文件与图片');
  await expect(page.getByRole('heading', { name: '文件与图片', exact: true })).toBeVisible();
  await navigate(page, '排行与运营');
  await expect(page.getByLabel('点赞权重', { exact: true })).toHaveValue('0.5');
  await expect(page.getByLabel('处理理由', { exact: true })).toHaveValue('双端核对冻结评分配置');
  await page.getByRole('button', { name: '预览默认设置', exact: true }).click();
  await expect(
    page.getByRole('alertdialog', { name: '核对排行与运营默认设置', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '保留当前输入', exact: true }).click();
  await page.getByRole('button', { name: '保存排行与运营设置', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: '确认调整榜单计算规则', exact: true });
  await dialog.getByRole('button', { name: '返回核对', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存排行与运营设置', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '保存排行与运营设置', exact: true }).click();
  await dialog.getByRole('button', { name: '确认并保存', exact: true }).click();
  await expect(
    page.getByText('排行与运营设置已保存，已提交新批次计算请求，计算完成后更新榜单', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '核对最新排行与运营设置', exact: true }),
  ).toBeFocused();
  const settings = RankingSettingsResponseSchema.parse(await (await page.request.get(path)).json());
  await expect
    .poll(async () => {
      const result = await page.request.get('/api/v1/rankings');
      return result.status() === 200
        ? RankingListResponseSchema.parse(await result.json()).meta.definition?.settingsRevision
        : undefined;
    })
    .toBe(settings.meta.revision);
  await page.goto('/rankings');
  await page.getByRole('button', { name: '统计说明', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '这份榜单如何计算', exact: true })).toContainText(
    '有效点赞×0.5、收藏×4、导出×1',
  );
  await expect(page.getByRole('dialog', { name: '这份榜单如何计算', exact: true })).toContainText(
    '设置修订 ' + settings.meta.revision,
  );
});
test('CAS冲突保留输入与理由，显式核对最新修订后再次确认，历史展示真实差异', async ({ page }) => {
  await loginBrowserAdmin(page);
  await page.goto('/admin/settings/rankings');
  await page.getByLabel('点赞权重', { exact: true }).fill('0.75');
  await page.getByLabel('处理理由', { exact: true }).fill('保留我的候选输入');
  const snapshot = RankingSettingsResponseSchema.parse(await (await page.request.get(path)).json());
  expect(
    (
      await browserWrite(
        page,
        path,
        { data: { ...snapshot.data, entryLimit: 900 }, reason: '另一管理员更新展示量' },
        'PATCH',
        {
          'If-Match': rankingSettingsEtag(snapshot.meta.revision),
          'Idempotency-Key': randomUUID(),
        },
      )
    ).status(),
  ).toBe(200);
  await page.getByRole('button', { name: '保存排行与运营设置', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '确认并保存', exact: true })
    .click();
  await expect(
    page.getByText('排行与运营设置已变化，请核对最新修订', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('点赞权重', { exact: true })).toHaveValue('0.75');
  await expect(page.getByLabel('处理理由', { exact: true })).toHaveValue('保留我的候选输入');
  await page.getByRole('button', { name: '核对最新排行与运营设置', exact: true }).click();
  await page.getByRole('button', { name: '采用最新修订继续核对', exact: true }).click();
  await page.getByRole('button', { name: '保存排行与运营设置', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '确认并保存', exact: true })
    .click();
  await expect(
    page.getByText('排行与运营设置已保存，已提交新批次计算请求，计算完成后更新榜单', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: '查看修改记录', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '排行与运营修改记录', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('保留我的候选输入', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查看修改差异', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '修改前', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '修改后', exact: true })).toBeVisible();
});
test('无效权重和已折叠参数阻止提交并展开字段，修正后保留全部输入', async ({ page }) => {
  await loginBrowserAdmin(page);
  await page.goto('/admin/settings/rankings');
  await page.getByLabel('点赞权重', { exact: true }).fill('-1');
  await page.getByLabel('处理理由', { exact: true }).fill('核对表单范围');
  await page.getByRole('button', { name: '保存排行与运营设置', exact: true }).click();
  await expect(page.getByLabel('点赞权重', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.getByLabel('点赞权重', { exact: true }).fill('1.25');
  await page.getByRole('button', { name: '调整刷新和展示设置', exact: true }).click();
  await page.getByLabel('每榜展示上限', { exact: true }).fill('0');
  await page.getByRole('button', { name: '收起刷新和展示设置', exact: true }).click();
  await page.getByRole('button', { name: '保存排行与运营设置', exact: true }).click();
  await expect(page.getByLabel('每榜展示上限', { exact: true })).toBeVisible();
  await expect(page.getByLabel('每榜展示上限', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByLabel('每榜展示上限', { exact: true })).toBeFocused();
  await expect(page.getByLabel('点赞权重', { exact: true })).toHaveValue('1.25');
  await expect(page.getByLabel('处理理由', { exact: true })).toHaveValue('核对表单范围');
});

test('保存响应丢失后跨页恢复原请求，显式核对复用幂等标识且不增加第二个批次', async ({ page }) => {
  await loginBrowserAdmin(page);
  await page.goto('/admin/settings/rankings');
  await page.getByLabel('点赞权重', { exact: true }).fill('0.25');
  await page.getByLabel('处理理由', { exact: true }).fill('核对网络结果未知后的原请求');
  let originalKey: string | undefined, replayKey: string | undefined;
  await page.route('**/api/v1/admin/settings/rankings', async (route) => {
    if (route.request().method() !== 'PATCH') {
      await route.continue();
      return;
    }
    originalKey = route.request().headers()['idempotency-key'];
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort('failed');
  });
  await page.getByRole('button', { name: '保存排行与运营设置', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '确认并保存', exact: true })
    .click();
  await expect(page.getByRole('button', { name: '核对原提交结果', exact: true })).toBeVisible();
  await page.unroute('**/api/v1/admin/settings/rankings');
  const revision = RankingSettingsResponseSchema.parse(await (await page.request.get(path)).json())
    .meta.revision;
  async function manualRequests() {
    const database = rankingDatabase();
    try {
      return Number(
        (
          await database.pool.query(
            'SELECT count(*)::int AS n FROM ranking_generations WHERE settings_revision=$1 AND request_key LIKE $2',
            [revision, 'manual:interactions-v2:%'],
          )
        ).rows[0]?.n,
      );
    } finally {
      await database.close();
    }
  }
  const requestsBefore = await manualRequests();
  page.once('dialog', (dialog) => dialog.accept());
  await navigate(page, '文件与图片');
  await expect(page.getByRole('heading', { name: '文件与图片', exact: true })).toBeVisible();
  await navigate(page, '排行与运营');
  await expect(page.getByLabel('点赞权重', { exact: true })).toHaveValue('0.25');
  await expect(page.getByLabel('处理理由', { exact: true })).toHaveValue(
    '核对网络结果未知后的原请求',
  );
  page.on('request', (request) => {
    if (request.url().endsWith(path) && request.method() === 'PATCH')
      replayKey = request.headers()['idempotency-key'];
  });
  await page.getByRole('button', { name: '核对原提交结果', exact: true }).click();
  await expect(page.getByText('原提交结果待核对', { exact: true })).toHaveCount(0);
  expect(originalKey).toBeTruthy();
  expect(replayKey).toBe(originalKey);
  expect(
    RankingSettingsResponseSchema.parse(await (await page.request.get(path)).json()).meta.revision,
  ).toBe(revision);
  expect(await manualRequests()).toBe(requestsBefore);
});
