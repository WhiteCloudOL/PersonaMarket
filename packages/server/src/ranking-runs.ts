import { and, eq, sql } from 'drizzle-orm';
import {
  outboxEvents,
  rankingGenerations,
  rankingGenerationRuns,
  type Database,
} from '@personamarket/database';
import { rankingEventMatches } from './ranking-run-policy.js';

export type RankingTransaction = Parameters<Parameters<Database['db']['transaction']>[0]>[0];
export class RankingBusyError extends Error {}
export async function lockRankingComputation(tx: RankingTransaction) {
  const result = await tx.execute<{ acquired: boolean }>(
    sql`SELECT pg_try_advisory_xact_lock(1347244619,1) AS acquired`,
  );
  if (!result.rows[0]?.acquired) throw new RankingBusyError('RANKING_REFRESH_BUSY');
}
export async function createRankingRun(
  tx: RankingTransaction,
  generationId: string,
  eventId: string,
) {
  await tx
    .insert(rankingGenerationRuns)
    .values({ generationId, eventId, manualRound: 0, origin: 'created' });
  await tx
    .update(rankingGenerations)
    .set({ currentEventId: eventId })
    .where(eq(rankingGenerations.id, generationId));
}
/** 必须在PMRK/1之后调用；旧事件没有歧义时才可显式收养，GET从不调用。 */
export async function lockRankingRun(
  tx: RankingTransaction,
  generationId: string,
  eventId: string,
  adoptLegacy: boolean,
  automaticAttemptLimit = 5,
) {
  const [generation] = await tx
    .select()
    .from(rankingGenerations)
    .where(eq(rankingGenerations.id, generationId))
    .for('update');
  if (!generation) throw Error('RANKING_GENERATION_NOT_FOUND');
  const [run] = await tx
    .select()
    .from(rankingGenerationRuns)
    .where(
      and(
        eq(rankingGenerationRuns.generationId, generationId),
        eq(rankingGenerationRuns.eventId, eventId),
      ),
    )
    .for('update');
  const [event] = await tx
    .select()
    .from(outboxEvents)
    .where(eq(outboxEvents.id, eventId))
    .for('update');
  if (!event || !rankingEventMatches(generationId, eventId, event))
    throw Error('RANKING_EVENT_UNVERIFIABLE');
  if (generation.currentEventId)
    return { generation, run: run ?? null, event, current: generation.currentEventId === eventId };
  if (!adoptLegacy || generation.status === 'completed')
    return { generation, run: null, event, current: false };
  const candidates = await tx
    .select({ id: outboxEvents.id })
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.topic, 'rankings.refresh'),
        sql`lower(${outboxEvents.payload}->>'generationId')=${generationId}`,
      ),
    );
  const history = await tx.execute<{ n: number }>(
    sql`SELECT count(*)::integer n FROM admin_task_retries WHERE source='ranking' AND task_id=${generationId}::uuid`,
  );
  if (candidates.length !== 1 || candidates[0]?.id !== eventId || history.rows[0]?.n !== 0)
    throw Error('RANKING_LEGACY_LINEAGE_UNVERIFIABLE');
  const result = await tx.execute<{ present: boolean }>(
    sql`SELECT EXISTS(SELECT 1 FROM ranking_boards WHERE generation_id=${generationId}::uuid) OR EXISTS(SELECT 1 FROM processed_events WHERE consumer='rankings' AND event_id=${eventId}::uuid) AS present`,
  );
  if (result.rows[0]?.present) throw Error('RANKING_LEGACY_RESULT_UNVERIFIABLE');
  const [created] = await tx
    .insert(rankingGenerationRuns)
    .values({
      generationId,
      eventId,
      manualRound: 0,
      origin: 'legacy_adopted',
      automaticAttemptLimit,
    })
    .returning();
  if (!created) throw Error('RANKING_RUN_CREATE_FAILED');
  await tx
    .update(rankingGenerations)
    .set({ currentEventId: eventId })
    .where(eq(rankingGenerations.id, generationId));
  return {
    generation: { ...generation, currentEventId: eventId },
    run: created,
    event,
    current: true,
  };
}

/** 计算回滚后的独立收尾；以同锁序重新核对指针，旧轮失败不能覆写新轮。 */
export async function recordRankingFailure(
  database: Database,
  generationId: string,
  eventId: string,
  attempt: { number: number; last: boolean; limit?: number },
  code: 'RANKING_REFRESH_BUSY' | 'RANKING_BUILD_FAILED',
) {
  const limit = attempt.limit ?? 5;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(attempt.number) ||
    attempt.number < 1 ||
    attempt.number > limit
  )
    return;
  await database.db.transaction(async (tx) => {
    await lockRankingComputation(tx);
    const { generation, run, current } = await lockRankingRun(
      tx,
      generationId,
      eventId,
      true,
      limit,
    );
    if (
      !current ||
      !run ||
      generation.status === 'completed' ||
      run.state === 'completed' ||
      run.state === 'failed'
    )
      return;
    if (
      (attempt.limit ?? 5) !== run.automaticAttemptLimit ||
      !Number.isSafeInteger(attempt.number) ||
      attempt.number < 1 ||
      attempt.number > run.automaticAttemptLimit
    )
      return;
    const final = attempt.last && attempt.number >= run.automaticAttemptLimit;
    await tx
      .update(rankingGenerationRuns)
      .set({
        state: final ? 'failed' : 'retrying',
        executionAttempts: attempt.number,
        lastAttemptedAt: sql`clock_timestamp()`,
        lastErrorCode: code,
        terminalProof: final ? 'worker_final_failure' : null,
        terminalObservedAt: final ? sql`clock_timestamp()` : null,
      })
      .where(eq(rankingGenerationRuns.eventId, eventId));
    await tx
      .update(rankingGenerations)
      .set({
        status: final ? 'failed' : 'pending',
        errorCode: final ? code : null,
        attempts: sql`greatest(${rankingGenerations.attempts},${attempt.number})`,
      })
      .where(eq(rankingGenerations.id, generationId));
  });
}
