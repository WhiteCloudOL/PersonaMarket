import { expect, type Page } from '@playwright/test';

export async function openExploreFilters(page: Page) {
  await expect(page.getByRole('heading', { name: '探索人设', exact: true })).toBeVisible();
  const trigger =
    (page.viewportSize()?.width ?? 1440) >= 1024
      ? page.getByRole('button', { name: /^高级筛选/ })
      : page.getByRole('button', { name: '筛选人设', exact: true });
  await trigger.click();
  const sheet = page.getByRole('dialog', { name: '筛选人设', exact: true });
  await expect(sheet).toBeVisible();
  return { sheet, trigger };
}

export async function applyExploreFilters(page: Page) {
  const sheet = page.getByRole('dialog', { name: '筛选人设', exact: true });
  await sheet.getByRole('button', { name: '查看结果', exact: true }).click();
  await expect(sheet).toBeHidden();
}

export async function selectExploreFilter(page: Page, label: string, option: string) {
  const { sheet } = await openExploreFilters(page);
  if (label === '分类' || label === '标签 / 风格')
    await sheet
      .getByRole('group', { name: label + '选项', exact: true })
      .getByRole('button', { name: option, exact: true })
      .click();
  else {
    await sheet.getByRole('combobox', { name: label + '筛选', exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  }
  await applyExploreFilters(page);
}
