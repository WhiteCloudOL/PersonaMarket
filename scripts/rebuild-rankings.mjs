import { createDatabase } from '@personamarket/database';
import { enqueueConfiguredRankingRefresh, parseServerEnvironment } from '@personamarket/server';
import { environment } from './runtime.mjs';

const env = parseServerEnvironment(environment());
const database = createDatabase(env.DATABASE_URL);
try {
  const generationId = await enqueueConfiguredRankingRefresh(database, 'manual');
  if (!generationId) throw new Error('RANKING_REQUEST_NOT_CREATED');
  console.log(JSON.stringify({ event: 'rankings.refresh_requested', generationId }));
  console.log('已提交重建请求，请保持 Worker 与 Redis 运行，生成完成后刷新排行榜');
} catch {
  console.error('排行榜重建请求未提交，请检查数据库与运行配置');
  process.exitCode = 1;
} finally {
  await database.close();
}
