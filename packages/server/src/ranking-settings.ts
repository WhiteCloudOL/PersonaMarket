import { eq, sql } from 'drizzle-orm';
import {
  siteSettings,
  rankingGenerations,
  outboxEvents,
  type Database,
} from '@personamarket/database';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  CONFIGURABLE_RANKING_ALGORITHM,
  RankingDefinitionSchema,
  RankingSettingsSchema,
} from '@personamarket/contracts';
import { BusinessError } from './errors.js';
import { createRankingRun } from './ranking-runs.js';

type Transaction = Parameters<Parameters<Database['db']['transaction']>[0]>[0];
/** 与配置写入共用事务，冻结排队时的参数，Worker不读取后来配置 */
export async function enqueueConfiguredRankingRefreshInTransaction(
  tx: Transaction,
  mode: 'scheduled' | 'manual' = 'scheduled',
) {
  const [row] = await tx
    .select()
    .from(siteSettings)
    .where(eq(siteSettings.key, 'rankings'))
    .for('share');
  if (!row) throw new BusinessError('SERVICE_UNAVAILABLE', '排行设置尚未完成初始化');
  const settings = RankingSettingsSchema.parse(row.value);
  const definition = RankingDefinitionSchema.parse({
    settingsRevision: row.revision,
    settings,
    halfLifeSeconds: 604800,
  });
  const clock = await tx.execute<{ at: unknown }>(sql`SELECT clock_timestamp() AS at`);
  const at = z.coerce.date().parse(clock.rows[0]?.at);
  const interval = settings.refreshMinutes * 60_000;
  const slot = new Date(Math.floor(at.getTime() / interval) * interval);
  const prefix = CONFIGURABLE_RANKING_ALGORITHM + ':' + row.revision + ':';
  const requestKey =
    mode === 'manual'
      ? 'manual:' + prefix + randomUUID()
      : 'scheduled:' + prefix + slot.toISOString();
  const [generation] = await tx
    .insert(rankingGenerations)
    .values({
      requestKey,
      algorithm: CONFIGURABLE_RANKING_ALGORITHM,
      settingsRevision: row.revision,
      definition,
    })
    .onConflictDoNothing({ target: rankingGenerations.requestKey })
    .returning({ id: rankingGenerations.id });
  if (!generation) return null;
  const [event] = await tx
    .insert(outboxEvents)
    .values({ topic: 'rankings.refresh', payload: { generationId: generation.id } })
    .returning({ id: outboxEvents.id });
  if (!event) throw Error('RANKING_EVENT_CREATE_FAILED');
  await createRankingRun(tx, generation.id, event.id);
  return generation.id;
}
export function enqueueConfiguredRankingRefresh(
  database: Database,
  mode: 'scheduled' | 'manual' = 'scheduled',
) {
  return database.db.transaction((tx) => enqueueConfiguredRankingRefreshInTransaction(tx, mode));
}
