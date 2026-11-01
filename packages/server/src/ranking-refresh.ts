import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import {
  RANKING_ALGORITHM,
  CONFIGURABLE_RANKING_ALGORITHM,
  RankingDefinitionSchema,
  RANKING_REFRESH_MS,
  RankingAlgorithmSchema,
  RankingPlatformSchema,
  rankingBoardCombinations,
} from '@personamarket/contracts';
import {
  rankingGenerations,
  outboxEvents,
  processedEvents,
  rankingGenerationRuns,
  type Database,
} from '@personamarket/database';
import { calculateRankingEntries } from './ranking-calculation.js';
import {
  createRankingRun,
  lockRankingComputation,
  lockRankingRun,
  recordRankingFailure,
  RankingBusyError,
} from './ranking-runs.js';
import { rankingEventMatches } from './ranking-run-policy.js';

/** 周期请求由数据库时间去重；请求与Outbox同事务，手动重建由受控宿主机CLI调用 */
export async function enqueueRankingRefresh(
  database: Database,
  mode: 'scheduled' | 'manual' = 'scheduled',
) {
  return database.db.transaction(async (tx) => {
    const clock = await tx.execute<{ at: unknown }>(sql`SELECT clock_timestamp() AS at`);
    const parsedTime = z.coerce.date().safeParse(clock.rows[0]?.at);
    if (!parsedTime.success) throw new Error('RANKING_CLOCK_UNAVAILABLE');
    const at = parsedTime.data;
    const slot = new Date(Math.floor(at.getTime() / RANKING_REFRESH_MS) * RANKING_REFRESH_MS);
    const requestKey =
      mode === 'manual'
        ? 'manual:' + RANKING_ALGORITHM + ':' + randomUUID()
        : 'scheduled:' + RANKING_ALGORITHM + ':' + slot.toISOString();
    const [generation] = await tx
      .insert(rankingGenerations)
      .values({ requestKey, algorithm: RANKING_ALGORITHM })
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
  });
}

/** 至少一次处理：实际版本的全部榜板、完成状态和消费凭据一起提交 */
export async function buildRankingGeneration(
  database: Database,
  generationId: string,
  eventId: string,
  attempt: { number: number; last: boolean; limit?: number } = { number: 1, last: false },
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
    throw Error('RANKING_ATTEMPT_UNVERIFIABLE');
  try {
    return await database.db.transaction(
      async (tx) => {
        await lockRankingComputation(tx);
        const [done] = await tx
          .select({ eventId: processedEvents.eventId })
          .from(processedEvents)
          .where(
            and(eq(processedEvents.consumer, 'rankings'), eq(processedEvents.eventId, eventId)),
          )
          .limit(1);
        if (done) {
          // 批次已正常裁剪仍可确认原事件重复，但必须先核对其真实Outbox身份。
          const [event] = await tx.select().from(outboxEvents).where(eq(outboxEvents.id, eventId));
          if (!rankingEventMatches(generationId, eventId, event))
            throw Error('RANKING_EVENT_UNVERIFIABLE');
          return false;
        }
        const locked = await lockRankingRun(tx, generationId, eventId, true, limit);
        const { generation, run } = locked;
        if (!locked.current) {
          // 此Outbox严格属于旧轮；忽略凭据不能冒充当前轮业务成功。
          await tx
            .insert(processedEvents)
            .values({ consumer: 'rankings', eventId })
            .onConflictDoNothing();
          return false;
        }
        if (!run) throw Error('RANKING_RUN_NOT_FOUND');
        if (run.state === 'failed' || run.state === 'completed') return false;
        if (
          (attempt.limit ?? 5) !== run.automaticAttemptLimit ||
          !Number.isSafeInteger(attempt.number) ||
          attempt.number < 1 ||
          attempt.number > run.automaticAttemptLimit
        )
          throw Error('RANKING_ATTEMPT_UNVERIFIABLE');
        const algorithm = RankingAlgorithmSchema.safeParse(generation.algorithm);
        if (!algorithm.success) throw new Error('RANKING_ALGORITHM_MISMATCH');
        if (generation.status !== 'completed') {
          const clock = await tx.execute<{ at: unknown }>(
            sql`SELECT transaction_timestamp() AS at`,
          );
          const parsedTime = z.coerce.date().safeParse(clock.rows[0]?.at);
          if (!parsedTime.success) throw new Error('RANKING_CLOCK_UNAVAILABLE');
          const at = parsedTime.data;
          const definition =
            algorithm.data === CONFIGURABLE_RANKING_ALGORITHM
              ? RankingDefinitionSchema.parse(generation.definition)
              : undefined;
          await calculateRankingEntries(tx, generationId, at, algorithm.data, definition);
          const boards = await tx.execute<{ total: number }>(
            sql`SELECT count(*)::integer AS total FROM ranking_boards WHERE generation_id=${generationId}::uuid`,
          );
          const expectedBoards =
            rankingBoardCombinations(algorithm.data).length * RankingPlatformSchema.options.length;
          if (boards.rows[0]?.total !== expectedBoards)
            throw new Error('RANKING_BOARD_SET_INCOMPLETE');
          await tx
            .update(rankingGenerations)
            .set({
              status: 'completed',
              generatedAt: at,
              errorCode: null,
              attempts: sql`greatest(${rankingGenerations.attempts},${attempt.number})`,
            })
            .where(eq(rankingGenerations.id, generationId));
          await tx
            .update(rankingGenerationRuns)
            .set({
              state: 'completed',
              executionAttempts: attempt.number,
              lastAttemptedAt: at,
              lastErrorCode: null,
              terminalProof: 'worker_completed',
              terminalObservedAt: sql`clock_timestamp()`,
            })
            .where(eq(rankingGenerationRuns.eventId, eventId));
        }
        await tx
          .insert(processedEvents)
          .values({ consumer: 'rankings', eventId })
          .onConflictDoNothing();
        return generation.status !== 'completed';
      },
      { isolationLevel: 'repeatable read' },
    );
  } catch (cause) {
    // 失败计算已回滚；按同锁序重查当前指针，迟到旧事件不能写新一轮状态。
    if (!(cause instanceof RankingBusyError) || attempt.last)
      try {
        await recordRankingFailure(
          database,
          generationId,
          eventId,
          attempt,
          cause instanceof RankingBusyError ? 'RANKING_REFRESH_BUSY' : 'RANKING_BUILD_FAILED',
        );
      } catch {
        /* 无法取得锁或核验身份时保持未知，不裸写generation制造终态。 */
      }
    throw cause;
  }
}

/** 留12批成功快照供稳定分页；清理只触及可重建的排序事实，失败请求保留7天供排查 */
export async function pruneRankings(database: Database) {
  return database.db.transaction(async (tx) => {
    try {
      await lockRankingComputation(tx);
    } catch (cause) {
      if (cause instanceof RankingBusyError) return 0;
      throw cause;
    }
    const result = await tx.execute(sql`DELETE FROM ranking_generations WHERE id IN (
    SELECT id FROM (SELECT id,row_number() OVER (PARTITION BY algorithm ORDER BY settings_revision DESC NULLS LAST,generated_at DESC,id DESC) AS n FROM ranking_generations WHERE status='completed') kept WHERE n>12 LIMIT 1
  ) OR id IN (
    SELECT g.id FROM ranking_generations g JOIN ranking_generation_runs r ON r.generation_id=g.id AND r.event_id=g.current_event_id
    WHERE g.status='failed' AND r.state='failed' AND r.terminal_observed_at<now()-interval '7 days'
    AND NOT EXISTS(SELECT 1 FROM admin_task_retries a WHERE a.source='ranking' AND a.task_id=g.id AND a.created_at>=now()-interval '7 days')
    ORDER BY r.terminal_observed_at,g.id LIMIT 100
  )`);
    return result.rowCount ?? 0;
  });
}
