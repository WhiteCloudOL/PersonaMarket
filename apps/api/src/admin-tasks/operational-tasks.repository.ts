import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  outboxEvents,
  storageCleanupRuns,
  mailDeliveries,
  operationalTaskActions,
  adminTaskRetries,
  authAuditEvents,
  idempotencyKeys,
  type Database,
} from '@personamarket/database';
import {
  OperationalTaskDetailResponseSchema,
  OperationalTaskActionResponseSchema,
  OperationalTaskReceiptResponseSchema,
  StorageCleanupJobSchema,
  type OperationalTaskPath,
  type OperationalTaskCommand,
} from '@personamarket/contracts';
import { BusinessError, contentHash, readMailContext } from '@personamarket/server';
import { DATABASE } from '../tokens.js';
import { lockIdentity, type Transaction } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import { administrationTransaction } from '../admin/administration-transaction.js';
import { idempotentResult, rememberResult } from '../releases/release-helpers.js';

const operation = 'admin.operation.handle';
const actionView = (row: typeof operationalTaskActions.$inferSelect) => ({
  id: row.id,
  action: row.action,
  eventId: row.eventId,
  actorId: row.actorId,
  reason: row.reason,
  recordedAt: row.createdAt.toISOString(),
});
async function facts(tx: Transaction, target: OperationalTaskPath, database: Database) {
  const [original] = await tx.select().from(outboxEvents).where(eq(outboxEvents.id, target.id));
  if (
    !original ||
    original.topic !== (target.kind === 'storage' ? 'storage.cleanup' : 'auth.email')
  )
    throw new BusinessError('NOT_FOUND', '原业务任务不存在或不属于此类处理');
  const [ownRun] = await tx
    .select()
    .from(storageCleanupRuns)
    .where(eq(storageCleanupRuns.eventId, original.id));
  const rootId = target.kind === 'storage' ? (ownRun?.requestId ?? original.id) : original.id;
  const [run] =
    target.kind === 'storage'
      ? await tx
          .select()
          .from(storageCleanupRuns)
          .where(eq(storageCleanupRuns.requestId, rootId))
          .orderBy(desc(storageCleanupRuns.manualRound))
          .limit(1)
      : [];
  const [latestEvent] = run
    ? await tx.select().from(outboxEvents).where(eq(outboxEvents.id, run.eventId))
    : [original];
  if (!latestEvent) throw new BusinessError('CONFLICT', '当前事件不可核验');
  const payload =
    target.kind === 'storage'
      ? StorageCleanupJobSchema.omit({ eventId: true }).safeParse(latestEvent.payload)
      : null;
  if (payload && !payload.success)
    throw new BusinessError('CONFLICT', '原清理目标不可核验，不能处理');
  const [mail] =
    target.kind === 'mail'
      ? await tx.select().from(mailDeliveries).where(eq(mailDeliveries.eventId, original.id))
      : [];
  const receipt = await tx.execute(
    sql`SELECT 1 FROM processed_events WHERE consumer=${target.kind === 'storage' ? 'storage-cleanup' : 'auth-email'} AND event_id=${latestEvent.id}::uuid`,
  );
  const history = await tx
    .select()
    .from(operationalTaskActions)
    .where(
      and(eq(operationalTaskActions.kind, target.kind), eq(operationalTaskActions.taskId, rootId)),
    )
    .orderBy(desc(operationalTaskActions.createdAt))
    .limit(20);
  const retries = await tx
    .select()
    .from(adminTaskRetries)
    .where(and(eq(adminTaskRetries.source, 'queue'), eq(adminTaskRetries.taskId, rootId)))
    .orderBy(desc(adminTaskRetries.attempt))
    .limit(3);
  const context =
    target.kind === 'mail' ? await readMailContext(database, original.id, undefined, tx) : null;
  return {
    context,
    original,
    rootId,
    run: run ?? null,
    latestEvent,
    payload: payload?.success ? payload.data : null,
    mail: mail ?? null,
    consumed: Boolean(receipt.rowCount),
    history,
    retries,
    // DB Date先转ISO，canonicalJson自身只处理JSON对象，不能把时刻归一成空对象。
    version: contentHash(
      JSON.parse(
        JSON.stringify({
          kind: target.kind,
          rootId,
          run: run ?? null,
          event: latestEvent,
          mail: mail ?? null,
          receipt: Boolean(receipt.rowCount),
          history,
          retries,
          context,
        }),
      ),
    ),
  };
}
function eligibility(f: Awaited<ReturnType<typeof facts>>, kind: OperationalTaskPath['kind']) {
  const status =
    kind === 'storage'
      ? (f.run?.outcome ?? (f.consumed ? 'unrecorded' : 'pending'))
      : (f.mail?.status ?? 'unrecorded');
  const last = f.retries[0],
    nextAllowedAt = last ? new Date(last.createdAt.getTime() + 60_000) : null;
  const terminalDispatch =
    !f.latestEvent.deliveredAt &&
    f.latestEvent.attempts >= 5 &&
    (!f.latestEvent.leaseUntil || f.latestEvent.leaseUntil.getTime() <= Date.now());
  const evidence = f.run?.outcome === 'failed' || (!f.run && f.consumed) || terminalDispatch;
  const blockedReason =
    kind === 'mail'
      ? '邮件只记录人工核对；结果未知不再发送，失效链接需由账号原流程重新申请'
      : ['deleted', 'missing', 'protected'].includes(status)
        ? '当前清理已有明确结果，无需再次处理'
        : (last?.attempt ?? 0) >= 3
          ? '已达到三轮人工处理上限'
          : nextAllowedAt && nextAllowedAt.getTime() > Date.now()
            ? '等待六十秒冷却后再核对'
            : !evidence
              ? '自动处理未终结或缺少可靠结果，暂不能人工重查'
              : '';
  return {
    status,
    canRetry: blockedReason === '',
    blockedReason,
    nextAllowedAt: nextAllowedAt?.toISOString() ?? null,
    manualAttempts: last?.attempt ?? 0,
  };
}
@Injectable()
export class OperationalTasksRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}
  detail(actor: Identity, target: OperationalTaskPath) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        const f = await facts(tx, target, this.database),
          available = eligibility(f, target.kind);
        return OperationalTaskDetailResponseSchema.parse({
          data: {
            kind: target.kind,
            id: f.rootId,
            eventId: f.latestEvent.id,
            ...available,
            targetFingerprint: f.payload
              ? createHash('sha256').update(f.payload.storageKey).digest('hex')
              : null,
            checkedAt:
              f.run?.checkedAt?.toISOString() ?? f.mail?.completedAt?.toISOString() ?? null,
            executionAttempts: f.run?.executionAttempts ?? f.mail?.attempts ?? null,
            context: f.context,
            disposition: f.history[0] ? actionView(f.history[0]) : null,
            history: f.history.map(actionView),
            version: f.version,
          },
          meta: { observedAt: new Date().toISOString() },
        });
      },
      { area: 'content' },
    );
  }
  handle(
    actor: Identity,
    target: OperationalTaskPath,
    input: OperationalTaskCommand,
    key: string,
    requestId: string,
  ) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        const command = { ...target, ...input },
          previous = await idempotentResult(tx, actor, operation, key, command);
        if (previous) return this.record(tx, previous, actor.account.id);
        let f = await facts(tx, target, this.database);
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${target.kind === 'storage' && f.payload ? 'cleanup:' + f.payload.storageKey : 'mail-action:' + f.rootId},0))`,
        );
        f = await facts(tx, target, this.database);
        if (f.version !== input.expectedVersion)
          throw new BusinessError('REVISION_CONFLICT', '业务状态已变化，请刷新核对，理由已保留');
        let eventId: string | null = null;
        if (input.action === 'retry') {
          if (target.kind !== 'storage' || !f.payload || !eligibility(f, target.kind).canRetry)
            throw new BusinessError(
              'CONFLICT',
              eligibility(f, target.kind).blockedReason || '不能重查此任务',
            );
          // 和Worker共用键锁；新事件不改变稳定请求身份或清零原历史。
          eventId = randomUUID();
          await tx
            .insert(outboxEvents)
            .values({ id: eventId, topic: 'storage.cleanup', payload: f.payload });
          await tx.insert(storageCleanupRuns).values({
            eventId,
            requestId: f.rootId,
            storageKey: f.payload.storageKey,
            manualRound: (f.retries[0]?.attempt ?? 0) + 1,
          });
          await tx.insert(adminTaskRetries).values({
            source: 'queue',
            taskId: f.rootId,
            eventId,
            previousEventId: f.latestEvent.id,
            actorId: actor.account.id,
            attempt: (f.retries[0]?.attempt ?? 0) + 1,
            expectedVersion: input.expectedVersion,
            reason: input.reason,
          });
        } else if (target.kind !== 'mail')
          throw new BusinessError('INVALID_INPUT', '文件清理请核对实际执行结果');
        const [record] = await tx
          .insert(operationalTaskActions)
          .values({
            kind: target.kind,
            taskId: f.rootId,
            action: input.action,
            eventId,
            actorId: actor.account.id,
            expectedVersion: input.expectedVersion,
            reason: input.reason,
          })
          .returning();
        if (!record) throw Error('OPERATIONAL_ACTION_INSERT_FAILED');
        await tx.insert(authAuditEvents).values({
          userId: actor.account.id,
          event: 'admin.' + target.kind + '.' + input.action,
          requestId,
        });
        await rememberResult(tx, actor, operation, key, command, record.id);
        return OperationalTaskActionResponseSchema.parse({ data: actionView(record) });
      },
      { area: 'content' },
    );
  }
  private async record(tx: Transaction, id: string, actorId: string) {
    const [record] = await tx
      .select()
      .from(operationalTaskActions)
      .where(and(eq(operationalTaskActions.id, id), eq(operationalTaskActions.actorId, actorId)));
    if (!record) throw new BusinessError('CONFLICT', '原操作回执不可核验');
    return OperationalTaskActionResponseSchema.parse({ data: actionView(record) });
  }
  receipt(actor: Identity, target: OperationalTaskPath, key: string, requestHash: string) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        const [saved] = await tx
          .select()
          .from(idempotencyKeys)
          .where(
            and(
              eq(idempotencyKeys.actorId, actor.account.id),
              eq(idempotencyKeys.operation, operation),
              eq(idempotencyKeys.key, key),
            ),
          );
        if (!saved) {
          await facts(tx, target, this.database);
          return OperationalTaskReceiptResponseSchema.parse({
            data: { recorded: false, record: null },
          });
        }
        if (saved.requestHash !== requestHash)
          throw new BusinessError('CONFLICT', '原请求指纹不匹配');
        const [record] = await tx
          .select()
          .from(operationalTaskActions)
          .where(
            and(
              eq(operationalTaskActions.id, saved.resultId),
              eq(operationalTaskActions.actorId, actor.account.id),
              eq(operationalTaskActions.kind, target.kind),
            ),
          );
        if (
          !record ||
          contentHash({
            ...target,
            action: record.action,
            expectedVersion: record.expectedVersion,
            reason: record.reason,
            confirmed: true,
          }) !== requestHash
        )
          throw new BusinessError('CONFLICT', '原操作和任务关联不可核验');
        return OperationalTaskReceiptResponseSchema.parse({
          data: { recorded: true, record: actionView(record) },
        });
      },
      { area: 'content' },
    );
  }
}
