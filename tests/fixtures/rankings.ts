import { expect, type Page } from '@playwright/test';
import { createDatabase } from '@personamarket/database';
import { enqueueConfiguredRankingRefresh } from '@personamarket/server';
import { RankingListResponseSchema } from '@personamarket/contracts';

export function rankingDatabase() {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url || !/^\/pm_e2e_[a-f0-9]{32}_test$/.test(new URL(url).pathname))
    throw new Error('榜单浏览器回归仅允许本轮受控测试库');
  return createDatabase(url);
}

export async function refreshRanking(page: Page) {
  const database = rankingDatabase();
  let id: string | null;
  try {
    id = await enqueueConfiguredRankingRefresh(database, 'manual');
  } finally {
    await database.close();
  }
  if (!id) throw new Error('未生成真实榜单请求');
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          '/api/v1/rankings?kind=updated&window=all&snapshotId=' + id,
        );
        if (response.status() !== 200) return null;
        return RankingListResponseSchema.parse(await response.json()).meta.snapshotId;
      },
      { timeout: 5000 },
    )
    .toBe(id);
  return id;
}
