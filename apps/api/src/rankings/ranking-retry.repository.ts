import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  adminTaskRetries,
  authAuditEvents,
  idempotencyKeys,
  outboxEvents,
  rankingGenerations,
  rankingGenerationRuns,
  type Database,
} from '@personamarket/database';
import {
  AdminRankingGenerationResponseSchema,
  AdminRankingRetryReceiptResponseSchema,
  AdminRankingRetryResponseSchema,
  type RetryAdminRankingGeneration,
} from '@personamarket/contracts';
import {
  BusinessError,
  contentHash,
  lockRankingComputation,
  lockRankingRun,
  RankingBusyError,
  sealRankingFailure,
  type RankingQueueObservation,
} from '@personamarket/server';
import type { Identity } from '../auth/auth.service.js';
import { lockIdentity, type Transaction } from '../auth/locked-identity.js';
import { administrationTransaction } from '../admin/administration-transaction.js';
import { idempotentResult, rememberResult } from '../releases/release-helpers.js';
import { DATABASE } from '../tokens.js';
import { rankingRetryFacts } from './ranking-retry-facts.js';

const operation = 'ranking.generation.retry';
const accepted = (id: string) =>
  AdminRankingRetryResponseSchema.parse({
    data: { generationId: id, accepted: true },
    meta: { observedAt: new Date().toISOString() },
  });
async function verifyRecordedCommand(
  tx: Transaction,
  recordId: string,
  actorId: string,
  generationId: string,
  requestHash: string,
) {
  const [record] = await tx
    .select()
    .from(adminTaskRetries)
    .where(
      and(
        eq(adminTaskRetries.id, recordId),
        eq(adminTaskRetries.actorId, actorId),
        eq(adminTaskRetries.source, 'ranking'),
        eq(adminTaskRetries.taskId, generationId),
      ),
    );
  if (!record)
    throw new BusinessError('SERVICE_UNAVAILABLE', '原恢复命令记录无法核验，请保留原请求核对');
  if (
    contentHash({
      id: generationId,
      expectedVersion: record.expectedVersion,
      reason: record.reason,
      confirmed: true,
    }) !== requestHash
  )
    throw new BusinessError('CONFLICT', '原请求与该批次或载荷不一致，请保留原操作核对');
  return record;
}
@Injectable()
export class RankingRetryRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}
  private transaction<T>(actor: Identity, read: boolean, action: (tx: Transaction) => Promise<T>) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        return action(tx);
      },
      { area: 'content', isolationLevel: read ? 'repeatable read' : 'read committed' },
    );
  }
  eventTarget(actor: Identity, id: string) {
    return this.transaction(actor, true, async (tx) => {
      const facts = await rankingRetryFacts(tx, id);
      return facts.generation.status !== 'completed' ? (facts.event?.id ?? null) : null;
    });
  }
  detail(actor: Identity, id: string, observation?: RankingQueueObservation) {
    return this.transaction(actor, true, async (tx) =>
      AdminRankingGenerationResponseSchema.parse({
        data: (await rankingRetryFacts(tx, id, observation)).data,
        meta: { observedAt: new Date().toISOString() },
      }),
    );
  }
  replay(actor: Identity, id: string, input: RetryAdminRankingGeneration, key: string) {
    return this.transaction(actor, true, async (tx) => {
      const command = { id, ...input };
      const previous = await idempotentResult(tx, actor, operation, key, command);
      if (!previous) return null;
      await verifyRecordedCommand(tx, previous, actor.account.id, id, contentHash(command));
      return accepted(id);
    });
  }
  receipt(actor: Identity, id: string, key: string, hash: string) {
    return this.transaction(actor, true, async (tx) => {
      const [previous] = await tx
        .select()
        .from(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.actorId, actor.account.id),
            eq(idempotencyKeys.operation, operation),
            eq(idempotencyKeys.key, key),
          ),
        );
      if (previous) {
        if (previous.requestHash !== hash)
          throw new BusinessError('CONFLICT', '原请求与该批次或载荷不一致，请保留原操作核对');
        const record = await verifyRecordedCommand(
          tx,
          previous.resultId,
          actor.account.id,
          id,
          hash,
        );
        return AdminRankingRetryReceiptResponseSchema.parse({
          data: { generationId: id, recorded: true, recordedAt: record.createdAt.toISOString() },
          meta: { observedAt: new Date().toISOString() },
        });
      }
      const [generation] = await tx
        .select({ id: rankingGenerations.id })
        .from(rankingGenerations)
        .where(eq(rankingGenerations.id, id));
      if (!generation)
        throw new BusinessError('NOT_FOUND', '原排行批次已清理且没有可核验的受理记录');
      return AdminRankingRetryReceiptResponseSchema.parse({
        data: { generationId: id, recorded: false, recordedAt: null },
        meta: { observedAt: new Date().toISOString() },
      });
    });
  }
  retry(
    actor: Identity,
    id: string,
    input: RetryAdminRankingGeneration,
    key: string,
    requestId: string,
    observation?: RankingQueueObservation,
  ) {
    return this.transaction(actor, false, async (tx) => {
      const command = { id, ...input },
        hash = contentHash(command);
      const previous = await idempotentResult(tx, actor, operation, key, command);
      if (previous) {
        await verifyRecordedCommand(tx, previous, actor.account.id, id, hash);
        return accepted(id);
      }
      try {
        await lockRankingComputation(tx);
      } catch (cause) {
        if (cause instanceof RankingBusyError)
          throw new BusinessError('SERVICE_UNAVAILABLE', '排行计算正在进行，请稍后重新核对', {
            retryAfterSeconds: 1,
          });
        throw cause;
      }
      const facts = await rankingRetryFacts(tx, id, observation, true);
      if (facts.data.version !== input.expectedVersion)
        throw new BusinessError('REVISION_CONFLICT', '原批次状态已变化，请重新核对后确认');
      if (!facts.data.retry.allowed) {
        if (facts.data.retry.blockedReason === 'COOLDOWN_ACTIVE')
          throw new BusinessError('RATE_LIMITED', '此批次仍在60秒冷却期，请稍后核对', {
            retryAfterSeconds: Math.max(
              1,
              Math.ceil((Date.parse(facts.data.retry.nextAllowedAt ?? '') - Date.now()) / 1000),
            ),
          });
        throw new BusinessError('CONFLICT', '原批次暂不能恢复，请核对当前事件、终态和人工次数');
      }
      if (!facts.event) throw new BusinessError('CONFLICT', '原事件无法核验，请保留原批次核对');
      const locked = await lockRankingRun(
        tx,
        id,
        facts.event.id,
        true,
        facts.retainedFinal ? (facts.matchedObservation?.limit ?? 5) : 5,
      );
      await sealRankingFailure(tx, locked, facts.matchedObservation);
      const [sealed] = await tx
        .select({ state: rankingGenerationRuns.state })
        .from(rankingGenerationRuns)
        .where(eq(rankingGenerationRuns.eventId, facts.event.id));
      if (sealed?.state !== 'failed')
        throw new BusinessError('CONFLICT', '自动执行终态无法核验，请保留原批次核对');
      const eventId = randomUUID(),
        round = facts.data.retry.recordedManualRound + 1;
      await tx
        .insert(outboxEvents)
        .values({ id: eventId, topic: 'rankings.refresh', payload: { generationId: id } });
      await tx
        .insert(rankingGenerationRuns)
        .values({ generationId: id, eventId, manualRound: round, origin: 'manual_retry' });
      await tx
        .update(rankingGenerations)
        .set({ currentEventId: eventId, status: 'pending', errorCode: null, generatedAt: null })
        .where(eq(rankingGenerations.id, id));
      const [record] = await tx
        .insert(adminTaskRetries)
        .values({
          source: 'ranking',
          taskId: id,
          eventId,
          previousEventId: facts.event.id,
          actorId: actor.account.id,
          attempt: round,
          expectedVersion: input.expectedVersion,
          reason: input.reason,
        })
        .returning({ id: adminTaskRetries.id });
      if (!record) throw Error('RANKING_RETRY_RECORD_CREATE_FAILED');
      await tx
        .insert(authAuditEvents)
        .values({ userId: actor.account.id, event: 'admin.ranking_retried', requestId });
      await rememberResult(tx, actor, operation, key, command, record.id);
      return accepted(id);
    });
  }
}
