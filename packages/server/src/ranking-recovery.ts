import { and, eq, sql } from 'drizzle-orm';
import { RankingRefreshJobSchema } from '@personamarket/contracts';
import {
  processedEvents,
  rankingGenerationRuns,
  rankingGenerations,
  type Database,
} from '@personamarket/database';
import { lockRankingComputation, lockRankingRun, RankingBusyError } from './ranking-runs.js';

export type RankingQueueObservation = {
  eventId: string;
  generationId: string;
  state: 'matched_final' | 'in_progress' | 'missing' | 'unavailable' | 'unverifiable';
  attempts: number | null;
  limit: number | null;
  finishedAt: string | null;
};
type RankingQueueReader = {
  getJob: (id: string) => Promise<
    | {
        id?: string | undefined;
        name: string;
        data: unknown;
        attemptsMade: number;
        opts: { attempts?: number | undefined };
        finishedOn?: number | undefined;
        getState: () => Promise<string>;
      }
    | undefined
  >;
};
/** 精确一个事件，不把500条采样、completed队列或旧generation.attempts当终态。 */
export async function observeRankingQueueEvent(
  queue: RankingQueueReader,
  generationId: string,
  eventId: string,
): Promise<RankingQueueObservation> {
  const empty = { eventId, generationId, attempts: null, limit: null, finishedAt: null };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async (): Promise<RankingQueueObservation> => {
        const job = await queue.getJob(eventId);
        if (!job) return { ...empty, state: 'missing' };
        const parsed = RankingRefreshJobSchema.safeParse(job.data);
        if (
          job.id !== eventId ||
          job.name !== 'rankings.refresh' ||
          !parsed.success ||
          parsed.data.eventId !== eventId ||
          parsed.data.generationId !== generationId
        )
          return { ...empty, state: 'unverifiable' };
        const limit = job.opts.attempts;
        if (
          !Number.isSafeInteger(limit) ||
          !limit ||
          limit < 1 ||
          limit > 100 ||
          !Number.isSafeInteger(job.attemptsMade) ||
          job.attemptsMade < 0
        )
          return { ...empty, state: 'unverifiable' };
        const state = await job.getState();
        if (state !== 'failed')
          return { ...empty, state: state === 'completed' ? 'unverifiable' : 'in_progress' };
        if (
          job.attemptsMade < limit ||
          !Number.isSafeInteger(job.finishedOn) ||
          !job.finishedOn ||
          job.finishedOn < 1 ||
          job.finishedOn > Date.now()
        )
          return { ...empty, state: 'unverifiable' };
        return {
          eventId,
          generationId,
          state: 'matched_final',
          attempts: job.attemptsMade,
          limit,
          finishedAt: new Date(job.finishedOn).toISOString(),
        };
      })(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(Error('RANKING_QUEUE_OBSERVATION_TIMEOUT')), 3000);
      }),
    ]);
  } catch {
    return { ...empty, state: 'unavailable' };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function sealRankingFailure(
  tx: Parameters<Parameters<Database['db']['transaction']>[0]>[0],
  locked: Awaited<ReturnType<typeof lockRankingRun>>,
  observation?: RankingQueueObservation,
) {
  const { generation, run, event, current } = locked;
  if (
    !current ||
    !run ||
    !event ||
    generation.status === 'completed' ||
    run.state === 'completed' ||
    run.state === 'failed'
  )
    return;
  const receipt = await tx
    .select({ id: processedEvents.eventId })
    .from(processedEvents)
    .where(and(eq(processedEvents.consumer, 'rankings'), eq(processedEvents.eventId, event.id)));
  if (receipt.length || (event.leaseUntil && event.leaseUntil.getTime() > Date.now())) return;
  const boards = await tx.execute<{ present: boolean }>(
    sql`SELECT EXISTS(SELECT 1 FROM ranking_boards WHERE generation_id=${generation.id}::uuid) AS present`,
  );
  if (boards.rows[0]?.present) return;
  const dispatch =
    !event.deliveredAt &&
    event.attempts >= 5 &&
    run.executionAttempts === null &&
    (!observation || observation.state === 'missing' || observation.state === 'unavailable');
  const retained =
    event.deliveredAt &&
    observation?.eventId === event.id &&
    observation.generationId === generation.id &&
    observation.state === 'matched_final' &&
    observation.limit === run.automaticAttemptLimit &&
    observation.attempts !== null &&
    observation.finishedAt &&
    Date.parse(observation.finishedAt) >= event.createdAt.getTime();
  if (!dispatch && !retained) return;
  const error = dispatch ? 'RANKING_DISPATCH_EXHAUSTED' : 'RANKING_BUILD_FAILED';
  await tx
    .update(rankingGenerationRuns)
    .set({
      state: 'failed',
      executionAttempts: dispatch ? null : (observation?.attempts ?? null),
      lastAttemptedAt: dispatch
        ? null
        : observation?.finishedAt
          ? new Date(observation.finishedAt)
          : null,
      lastErrorCode: error,
      terminalProof: dispatch ? 'dispatch_exhausted' : 'legacy_retained_final_failure',
      terminalObservedAt: sql`clock_timestamp()`,
    })
    .where(eq(rankingGenerationRuns.eventId, event.id));
  await tx
    .update(rankingGenerations)
    .set({ status: 'failed', generatedAt: null, errorCode: error })
    .where(eq(rankingGenerations.id, generation.id));
}

/** 有界收尾仅处理managed当前轮；查询队列时不持身份或计算锁。 */
export async function reconcileRankingFailures(database: Database, queue: RankingQueueReader) {
  const candidates = await database.db
    .select({ generationId: rankingGenerations.id, eventId: rankingGenerationRuns.eventId })
    .from(rankingGenerations)
    .innerJoin(
      rankingGenerationRuns,
      and(
        eq(rankingGenerationRuns.generationId, rankingGenerations.id),
        eq(rankingGenerationRuns.eventId, rankingGenerations.currentEventId),
      ),
    )
    .where(
      and(
        eq(rankingGenerations.status, 'pending'),
        sql`${rankingGenerationRuns.state} IN ('pending','retrying')`,
      ),
    )
    .orderBy(rankingGenerations.requestedAt, rankingGenerations.id)
    .limit(20);
  for (const row of candidates) {
    const observation = await observeRankingQueueEvent(queue, row.generationId, row.eventId);
    // 不可用不等于missing；本轮停止队列观测，不让20个超时串联拖住分发。
    if (observation.state === 'unavailable') return;
    try {
      await database.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout='3s'`);
        await lockRankingComputation(tx);
        await sealRankingFailure(
          tx,
          await lockRankingRun(tx, row.generationId, row.eventId, false),
          observation,
        );
      });
    } catch (cause) {
      if (cause instanceof RankingBusyError) return;
      throw cause;
    }
  }
}
