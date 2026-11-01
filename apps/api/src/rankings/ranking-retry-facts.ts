import { and, desc, eq, sql } from 'drizzle-orm';
import {
  adminTaskRetries,
  outboxEvents,
  processedEvents,
  rankingGenerations,
  rankingGenerationRuns,
} from '@personamarket/database';
import {
  AdminRankingGenerationSchema,
  RankingAlgorithmSchema,
  RankingDefinitionSchema,
  rankingBoardCombinations,
  RankingPlatformSchema,
} from '@personamarket/contracts';
import {
  BusinessError,
  contentHash,
  rankingEventMatches,
  rankingRetryEligibility,
  type RankingQueueObservation,
} from '@personamarket/server';
import type { Transaction } from '../auth/locked-identity.js';

export async function rankingRetryFacts(
  tx: Transaction,
  id: string,
  observation?: RankingQueueObservation,
  lock = false,
) {
  const generationQuery = tx
    .select()
    .from(rankingGenerations)
    .where(eq(rankingGenerations.id, id))
    .limit(1);
  const [generation] = lock ? await generationQuery.for('update') : await generationQuery;
  if (!generation) throw new BusinessError('NOT_FOUND', '原排行批次不存在或已清理，无法恢复');
  const algorithm = RankingAlgorithmSchema.parse(generation.algorithm);
  const parsedDefinition = RankingDefinitionSchema.safeParse(generation.definition);
  const definitionVerified =
    algorithm === 'interactions-v2'
      ? parsedDefinition.success &&
        parsedDefinition.data.settingsRevision === generation.settingsRevision
      : generation.definition === null && generation.settingsRevision === null;
  const definition =
    algorithm === 'interactions-v2' && parsedDefinition.success ? parsedDefinition.data : null;
  const runQuery = generation.currentEventId
    ? tx
        .select()
        .from(rankingGenerationRuns)
        .where(
          and(
            eq(rankingGenerationRuns.generationId, id),
            eq(rankingGenerationRuns.eventId, generation.currentEventId),
          ),
        )
        .limit(1)
    : null;
  const [run] = runQuery ? (lock ? await runQuery.for('update') : await runQuery) : [];
  const candidates = generation.currentEventId
    ? []
    : await tx
        .select({ id: outboxEvents.id })
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.topic, 'rankings.refresh'),
            sql`lower(${outboxEvents.payload}->>'generationId')=${id}`,
          ),
        )
        .limit(2);
  const eventId = generation.currentEventId ?? (candidates.length === 1 ? candidates[0]?.id : null);
  const eventQuery = eventId
    ? tx.select().from(outboxEvents).where(eq(outboxEvents.id, eventId)).limit(1)
    : null;
  const [event] = eventQuery ? (lock ? await eventQuery.for('update') : await eventQuery) : [];
  const currentEventProcessed = eventId
    ? (
        await tx
          .select({ id: processedEvents.eventId })
          .from(processedEvents)
          .where(
            and(eq(processedEvents.consumer, 'rankings'), eq(processedEvents.eventId, eventId)),
          )
          .limit(1)
      ).length > 0
    : false;
  const history = await tx
    .select()
    .from(adminTaskRetries)
    .where(and(eq(adminTaskRetries.source, 'ranking'), eq(adminTaskRetries.taskId, id)))
    .orderBy(desc(adminTaskRetries.attempt))
    .limit(3);
  const runs = await tx
    .select()
    .from(rankingGenerationRuns)
    .where(eq(rankingGenerationRuns.generationId, id))
    .limit(4);
  const manualRound = history[0]?.attempt ?? 0;
  const lineageVerified = generation.currentEventId
    ? Boolean(run) &&
      run?.manualRound === manualRound &&
      history.length === manualRound &&
      history.every((record) => {
        const own = runs.find((item) => item.manualRound === record.attempt);
        const previous = runs.find((item) => item.manualRound === record.attempt - 1);
        return own?.eventId === record.eventId && previous?.eventId === record.previousEventId;
      })
    : history.length === 0 && runs.length === 0;
  const counts = await tx.execute<{ boards: number }>(
    sql`SELECT count(*)::integer boards FROM ranking_boards WHERE generation_id=${id}::uuid`,
  );
  const boards = counts.rows[0]?.boards ?? 0;
  const expectedBoards =
    rankingBoardCombinations(algorithm).length * RankingPlatformSchema.options.length;
  const eventVerified = Boolean(
    eventId && rankingEventMatches(id, eventId, event) && lineageVerified,
  );
  const leaseActive = Boolean(event?.leaseUntil && event.leaseUntil.getTime() > Date.now());
  const matchedObservation =
    observation?.generationId === id && observation.eventId === eventId ? observation : undefined;
  const dispatchExhausted =
    eventVerified &&
    Boolean(event && !event.deliveredAt && event.attempts >= 5 && !leaseActive) &&
    !currentEventProcessed &&
    boards === 0 &&
    (!run || run.executionAttempts === null) &&
    (!matchedObservation ||
      matchedObservation.state === 'missing' ||
      matchedObservation.state === 'unavailable');
  const retainedFinal =
    eventVerified &&
    Boolean(event?.deliveredAt) &&
    !leaseActive &&
    matchedObservation?.state === 'matched_final' &&
    Boolean(
      event &&
      matchedObservation.finishedAt &&
      Date.parse(matchedObservation.finishedAt) >= event.createdAt.getTime(),
    ) &&
    (run
      ? matchedObservation.limit === run.automaticAttemptLimit
      : matchedObservation.limit !== null);
  const recordedTerminal =
    run?.state === 'failed' &&
    (run.terminalProof === 'dispatch_exhausted'
      ? dispatchExhausted
      : Boolean(
          event?.deliveredAt &&
          run.executionAttempts !== null &&
          run.executionAttempts >= run.automaticAttemptLimit &&
          ['worker_final_failure', 'legacy_retained_final_failure'].includes(
            run.terminalProof ?? '',
          ),
        ));
  const terminalVerified = Boolean(recordedTerminal || dispatchExhausted || retainedFinal);
  const nextAllowedAt = history[0]
    ? new Date(history[0].createdAt.getTime() + 60_000).toISOString()
    : null;
  const eligibility = rankingRetryEligibility({
    completed: generation.status === 'completed',
    definitionVerified,
    eventVerified,
    leaseActive,
    boards,
    currentEventProcessed,
    terminalVerified,
    automaticPending:
      Boolean(run && ['pending', 'retrying'].includes(run.state)) ||
      matchedObservation?.state === 'in_progress',
    legacyUnverifiable: !generation.currentEventId && !terminalVerified,
    manualRound,
    nextAllowedAt,
  });
  const verifiedCompletion =
    generation.status === 'completed' && boards === expectedBoards && definitionVerified;
  const completionState =
    generation.status !== 'completed'
      ? 'not_completed'
      : !verifiedCompletion
        ? 'unverifiable'
        : !generation.currentEventId
          ? 'legacy_only'
          : eventVerified &&
              run?.state === 'completed' &&
              run.terminalProof === 'worker_completed' &&
              currentEventProcessed
            ? 'verified'
            : 'unverifiable';
  // 时间戳/固定冷却截止进入指纹；本次观察时刻、动态倒计时不进入。
  const version = contentHash({
    generation: {
      ...generation,
      requestedAt: generation.requestedAt.toISOString(),
      generatedAt: generation.generatedAt?.toISOString() ?? null,
    },
    run: run
      ? {
          ...run,
          createdAt: run.createdAt.toISOString(),
          lastAttemptedAt: run.lastAttemptedAt?.toISOString() ?? null,
          terminalObservedAt: run.terminalObservedAt?.toISOString() ?? null,
        }
      : null,
    event: event
      ? {
          ...event,
          createdAt: event.createdAt.toISOString(),
          availableAt: event.availableAt.toISOString(),
          deliveredAt: event.deliveredAt?.toISOString() ?? null,
          leaseUntil: event.leaseUntil?.toISOString() ?? null,
        }
      : null,
    boards,
    currentEventProcessed,
    history: history.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
    lineageVerified,
    observation: run?.terminalProof ? null : (matchedObservation ?? null),
  });
  const data = AdminRankingGenerationSchema.parse({
    id,
    algorithm,
    requestedAt: generation.requestedAt.toISOString(),
    settingsRevision: generation.settingsRevision,
    definition,
    definitionVerified,
    businessStatus: generation.status,
    generatedAt: generation.generatedAt?.toISOString() ?? null,
    run: run
      ? {
          eventId: run.eventId,
          manualRound: run.manualRound,
          origin: run.origin,
          state: run.state,
          dispatchAttempts: eventVerified ? (event?.attempts ?? null) : null,
          executionAttempts: run.executionAttempts,
          automaticAttemptLimit: run.automaticAttemptLimit,
          lastAttemptedAt: run.lastAttemptedAt?.toISOString() ?? null,
          lastErrorCode: run.lastErrorCode,
          terminalProof: run.terminalProof,
          terminalObservedAt: run.terminalObservedAt?.toISOString() ?? null,
          currentEventProcessed,
        }
      : null,
    legacy: generation.currentEventId
      ? null
      : {
          candidateEventId: eventId ?? null,
          terminalVerified,
          dispatchAttempts: eventVerified ? (event?.attempts ?? null) : null,
          executionAttempts: retainedFinal ? (matchedObservation?.attempts ?? null) : null,
          observation: retainedFinal
            ? 'matched_final'
            : dispatchExhausted
              ? 'matched_final'
              : (matchedObservation?.state ?? 'unverifiable'),
        },
    completion: { state: completionState, expectedBoards, actualBoards: boards },
    retry: {
      ...eligibility,
      recordedManualRound: manualRound,
      maxManualRounds: 3,
      cooldownSeconds: 60,
      nextAllowedAt,
    },
    version,
  });
  return {
    data,
    generation,
    run: run ?? null,
    event: event ?? null,
    matchedObservation,
    dispatchExhausted,
    retainedFinal,
    history,
  };
}
