import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  DraftResponseSchema,
  ModelSuggestionsResponseSchema,
  PublicModelSuggestionsResponseSchema,
  modelSuggestionsEtag,
  type ModelSuggestions,
} from '@personamarket/contracts';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { browserWrite, loginCreator } from '../fixtures/browser-account.js';

test.use({ trace: 'off', screenshot: 'off' });
const path = '/api/v1/admin/settings/model-suggestions';
const route = '/admin/settings/model-suggestions';
async function settingLink(page: Page, name: string) {
  const trigger = page.getByRole('button', { name: '选择设置分组', exact: true });
  if (await trigger.isVisible()) await trigger.click();
  const link = page.getByRole('link', { name, exact: true });
  const href = await link.getAttribute('href');
  if (!href) throw new Error('设置导航缺少真实地址');
  await link.click();
  await expect(page).toHaveURL((url) => url.pathname === href);
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
}
async function save(page: Page, reason: string) {
  await page.getByLabel('处理理由', { exact: true }).fill(reason);
  const response = page.waitForResponse(
    (response) => response.url().endsWith(path) && response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: '保存模型建议', exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(200);
  return ModelSuggestionsResponseSchema.parse(await result.json());
}
async function replace(page: Page, data: ModelSuggestions) {
  const current = ModelSuggestionsResponseSchema.parse(await (await page.request.get(path)).json());
  const response = await browserWrite(page, path, { data, reason: '准备受控隔离建议' }, 'PATCH', {
    'If-Match': modelSuggestionsEtag(current.meta.revision),
    'Idempotency-Key': randomUUID(),
  });
  expect(response.status()).toBe(200);
  return ModelSuggestionsResponseSchema.parse(await response.json());
}

test('管理员排序停用和移除建议，作者主动选择并真实保存自由模型信息', async ({ page, browser }) => {
  await loginBrowserAdmin(page);
  await page.goto(route);
  const initial = ModelSuggestionsResponseSchema.parse(await (await page.request.get(path)).json());
  if (initial.data.entries.length) {
    await replace(page, { entries: [] });
    await page.reload();
  }
  await page.getByRole('button', { name: '添加模型建议', exact: true }).click();
  await page.getByLabel('建议 1 · 模型标识', { exact: true }).fill('fixture/provider-model');
  await page.getByLabel('建议 1 · 备注', { exact: true }).fill('请自行核对模型表现');
  await page.getByRole('button', { name: '添加模型建议', exact: true }).click();
  await page.getByLabel('建议 2 · 模型标识', { exact: true }).fill('fixture/disabled-model');
  await page.getByLabel('建议 2 · 备注', { exact: true }).fill('停用项不公开');
  await page.getByRole('switch', { name: '启用模型建议 2', exact: true }).click();
  const first = await save(page, '核对建议列表和停用范围');
  expect(first.data.entries).toHaveLength(2);
  const readPublic = async () =>
    PublicModelSuggestionsResponseSchema.parse(
      await (await page.request.get('/api/v1/site/model-suggestions')).json(),
    );
  expect((await readPublic()).data.map((entry) => entry.modelId)).toEqual([
    'fixture/provider-model',
  ]);
  const context = await browser.newContext({ viewport: page.viewportSize() });
  try {
    const author = await context.newPage();
    await loginCreator(author);
    await author.goto('/dashboard/personas/new');
    await author.getByLabel('人设名称', { exact: true }).fill('带有自定义模型的私有草稿');
    await author.getByRole('button', { name: '添加推荐模型', exact: true }).click();
    await author.getByLabel('模型 1 · 标识', { exact: true }).fill('  author/自由模型  ');
    await author.getByLabel('模型 1 · 备注', { exact: true }).fill('  保留我的原始备注  ');
    await author.getByRole('combobox', { name: '站点模型建议', exact: true }).click();
    await expect(
      author.getByRole('option', { name: 'fixture/disabled-model', exact: true }),
    ).toHaveCount(0);
    await author.getByRole('option', { name: 'fixture/provider-model', exact: true }).click();
    await expect(author.getByLabel('模型 1 · 标识', { exact: true })).toHaveValue(
      '  author/自由模型  ',
    );
    await expect(author.getByLabel('模型 2 · 标识', { exact: true })).toHaveValue(
      'fixture/provider-model',
    );
    await expect(author.getByLabel('模型 2 · 备注', { exact: true })).toHaveValue(
      '请自行核对模型表现',
    );
    await author.getByRole('button', { name: '创建私有草稿', exact: true }).click();
    await expect(author).toHaveURL(/\/dashboard\/personas\/[a-f0-9-]+\/edit$/);
    const id = author.url().split('/').at(-2);
    const draftPath = '/api/v1/me/personas/' + id + '/draft';
    const saved = DraftResponseSchema.parse(await (await author.request.get(draftPath)).json());
    expect(saved.data.draft.recommendedModels).toEqual([
      { modelId: '  author/自由模型  ', note: '  保留我的原始备注  ' },
      { modelId: 'fixture/provider-model', note: '请自行核对模型表现' },
    ]);
    await page.getByRole('button', { name: '上移模型建议 2', exact: true }).click();
    await expect(page.getByLabel('建议 1 · 模型标识', { exact: true })).toHaveValue(
      'fixture/disabled-model',
    );
    await page.getByRole('switch', { name: '启用模型建议 2', exact: true }).click();
    await save(page, '调整顺序并停用当前建议');
    expect((await readPublic()).data).toEqual([]);
    await page.getByRole('button', { name: '移除模型建议 2', exact: true }).click();
    await save(page, '移除建议不改写作者内容');
    const retained = DraftResponseSchema.parse(await (await author.request.get(draftPath)).json());
    expect(retained).toEqual(saved);
    await author.reload();
    await expect(author.getByLabel('模型 1 · 标识', { exact: true })).toHaveValue(
      '  author/自由模型  ',
    );
    await expect(author.getByLabel('模型 2 · 备注', { exact: true })).toHaveValue(
      '请自行核对模型表现',
    );
    await page.getByRole('button', { name: '查看修改差异', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: '修改前', exact: true })).toBeVisible();
    await page.getByLabel('定位模型建议', { exact: true }).fill('不会存在的模型');
    await expect(page).toHaveURL((url) => url.searchParams.get('modelQuery') === '不会存在的模型');
    await page.reload();
    await expect(page.getByText('没有匹配的模型建议', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '清空定位条件', exact: true }).click();
    await expect(page).toHaveURL((url) => !url.searchParams.has('modelQuery'));
  } finally {
    await context.close();
  }
});

test('模型设置失败复用幂等标识，冲突核对保留输入，离页草稿和默认对照可用', async ({ page }) => {
  await loginBrowserAdmin(page);
  const prepared = await replace(page, {
    entries: [{ id: randomUUID(), modelId: 'fixture/retry-model', note: '原备注', enabled: true }],
  });
  await page.goto(route);
  await page.getByLabel('建议 1 · 备注', { exact: true }).fill('本地保留的备注');
  await page.getByLabel('处理理由', { exact: true }).fill('失败后手动重试');
  const keys: string[] = [];
  let failed = false;
  await page.route('**' + path, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    keys.push(route.request().headers()['idempotency-key'] ?? '');
    if (!failed) {
      failed = true;
      return route.abort('failed');
    }
    return route.continue();
  });
  await page.getByRole('button', { name: '保存模型建议', exact: true }).click();
  await expect(
    page.getByRole('group', { name: '模型建议表单', exact: true }).getByRole('alert'),
  ).toBeVisible();
  await save(page, '失败后手动重试');
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  await page.unroute('**' + path);
  await page.getByLabel('建议 1 · 备注', { exact: true }).fill('冲突时保留我的输入');
  await page.getByLabel('处理理由', { exact: true }).fill('比较另一页面的修订');
  await replace(page, {
    entries: [
      {
        ...prepared.data.entries[0],
        id: randomUUID(),
        modelId: 'fixture/remote-model',
        note: '另一页面内容',
        enabled: false,
      },
    ],
  });
  const conflict = page.waitForResponse(
    (response) => response.url().endsWith(path) && response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: '保存模型建议', exact: true }).click();
  expect((await conflict).status()).toBe(412);
  await page.getByRole('button', { name: '核对最新模型建议', exact: true }).click();
  await page.getByRole('button', { name: '采用最新修订继续核对', exact: true }).click();
  await expect(page.getByLabel('建议 1 · 备注', { exact: true })).toHaveValue('冲突时保留我的输入');
  await save(page, '比较另一页面的修订');
  await page.getByLabel('建议 1 · 备注', { exact: true }).fill('跨页面仍保留');
  page.once('dialog', (dialog) => dialog.accept());
  await settingLink(page, '首页展示');
  await settingLink(page, '模型建议');
  await expect(page.getByLabel('建议 1 · 备注', { exact: true })).toHaveValue('跨页面仍保留');
  await page.getByRole('button', { name: '预览默认设置', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '填入默认值', exact: true })
    .click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(
    page.getByText('暂无模型建议，作者仍可自由填写模型名称', { exact: true }),
  ).toBeVisible();
  expect(
    ModelSuggestionsResponseSchema.parse(await (await page.request.get(path)).json()).data.entries,
  ).toHaveLength(1);
});
