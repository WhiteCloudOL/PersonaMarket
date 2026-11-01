import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  adminTaskRetries,
  authAuditEvents,
  outboxEvents,
  type Database,
} from '@personamarket/database';
import {
  ADMIN_TASK_RETRY_LIMIT,
  ADMIN_TASK_RETRY_COOLDOWN_SECONDS,
  AdminTaskRetrySchema,
  AdminTaskRetryResponseSchema,
  AdminTaskRetryHistoryResponseSchema,
  type AdminTaskPath,
  type RetryAdminTask,
} from '@personamarket/contracts';
import { BusinessError, type FailedQueueSample } from '@personamarket/server';
import type { Identity } from '../auth/auth.service.js';
import { lockIdentity, type Transaction } from '../auth/locked-identity.js';
import { administrationTransaction } from '../admin/administration-transaction.js';
import { idempotentResult, rememberResult } from '../releases/release-helpers.js';
import { DATABASE } from '../tokens.js';
import { prepareImageTaskRetry } from './image-task-retry.js';

function retryView(row: typeof adminTaskRetries.$inferSelect) {
  return AdminTaskRetrySchema.parse({
    id: row.id,
    source: row.source,
    taskId: row.taskId,
    eventId: row.eventId,
    previousEventId: row.previousEventId,
    actorId: row.actorId,
    attempt: row.attempt,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  });
}
async function readRetry(tx: Transaction, id: string, actorId: string) {
  const [record] = await tx
    .select()
    .from(adminTaskRetries)
    .where(and(eq(adminTaskRetries.id, id), eq(adminTaskRetries.actorId, actorId)));
  if (!record) throw new BusinessError('CONFLICT', '原重试记录不可用，请重新核对任务');
  return AdminTaskRetryResponseSchema.parse({ data: retryView(record) });
}

@Injectable()
export class AdminTaskRetriesRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}
  history(actor: Identity, target: AdminTaskPath) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        const rows = await tx
          .select()
          .from(adminTaskRetries)
          .where(
            and(eq(adminTaskRetries.source, target.source), eq(adminTaskRetries.taskId, target.id)),
          )
          .orderBy(desc(adminTaskRetries.attempt))
          .limit(ADMIN_TASK_RETRY_LIMIT);
        return AdminTaskRetryHistoryResponseSchema.parse({
          data: rows.map(retryView),
          meta: {
            maxAttempts: ADMIN_TASK_RETRY_LIMIT,
            cooldownSeconds: ADMIN_TASK_RETRY_COOLDOWN_SECONDS,
          },
        });
      },
      { area: 'content' },
    );
  }
  retry(
    actor: Identity,
    target: AdminTaskPath,
    input: RetryAdminTask,
    key: string,
    requestId: string,
    samples: FailedQueueSample[],
  ) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        // 主动重放跨账号远程任务会产生新外部请求，近期验证在幂等重放之前按实际MFA复查。
        await lockIdentity(tx, actor, true, true);
        const operation = 'admin.task.retry',
          command = { ...target, ...input };
        const previous = await idempotentResult(tx, actor, operation, key, command);
        if (previous) return readRetry(tx, previous, actor.account.id);
        if (target.source !== 'image' && target.source !== 'market_image')
          throw new BusinessError(
            'CONFLICT',
            '此类任务需通过原业务核对后处理，暂不能从任务中心重试',
          );
        const action = await prepareImageTaskRetry(
          tx,
          { source: target.source, id: target.id },
          input,
          samples,
        );
        const [latest] = await tx
          .select()
          .from(adminTaskRetries)
          .where(
            and(eq(adminTaskRetries.source, target.source), eq(adminTaskRetries.taskId, target.id)),
          )
          .orderBy(desc(adminTaskRetries.attempt))
          .limit(1);
        if (latest?.attempt === ADMIN_TASK_RETRY_LIMIT)
          throw new BusinessError('CONFLICT', '此任务已达到3次人工重试上限，请检查原业务');
        if (latest) {
          const wait = await tx.execute(
            sql`SELECT greatest(0,ceil(extract(epoch FROM ${latest.createdAt}::timestamptz+${ADMIN_TASK_RETRY_COOLDOWN_SECONDS}*interval '1 second'-clock_timestamp())))::integer AS seconds`,
          );
          const seconds = z
            .object({ seconds: z.coerce.number().int().min(0) })
            .parse(wait.rows[0]).seconds;
          if (seconds > 0)
            throw new BusinessError('RATE_LIMITED', '请等待冷却期结束后再核对任务', {
              retryAfterSeconds: seconds,
            });
        }
        await action.reset();
        const eventId = randomUUID();
        await tx
          .insert(outboxEvents)
          .values({ id: eventId, topic: action.topic, payload: action.payload });
        const [record] = await tx
          .insert(adminTaskRetries)
          .values({
            source: target.source,
            taskId: target.id,
            eventId,
            previousEventId: action.previousEventId,
            actorId: actor.account.id,
            attempt: (latest?.attempt ?? 0) + 1,
            expectedVersion: input.expectedVersion,
            reason: input.reason,
          })
          .returning();
        if (!record) throw new Error('TASK_RETRY_RECORD_INSERT_FAILED');
        await tx
          .insert(authAuditEvents)
          .values({ userId: actor.account.id, event: 'admin.task_retried', requestId });
        await rememberResult(tx, actor, operation, key, command, record.id);
        return AdminTaskRetryResponseSchema.parse({ data: retryView(record) });
      },
      { area: 'content', serializeWrites: true },
    );
  }
}
