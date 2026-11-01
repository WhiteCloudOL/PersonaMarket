import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { Database } from '@personamarket/database';
import type { inspectFailedQueueTasks } from '@personamarket/server';
import {
  ADMIN_TASK_QUEUE_SAMPLE_LIMIT,
  AdminTaskListResponseSchema,
  AdminTaskDetailResponseSchema,
  type AdminTaskQuery,
  type AdminTaskPath,
} from '@personamarket/contracts';
import type { Identity } from '../auth/auth.service.js';
import { lockIdentity } from '../auth/locked-identity.js';
import { administrationTransaction } from '../admin/administration-transaction.js';
import { DATABASE } from '../tokens.js';
import { taskFailureQuery } from './task-failure-query.js';
import { taskFailureRecordSchema, taskFailureVersion } from './task-failure-view.js';

@Injectable()
export class AdminTasksRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}
  list(
    actor: Identity,
    input: AdminTaskQuery,
    observation: Awaited<ReturnType<typeof inspectFailedQueueTasks>>,
    target?: AdminTaskPath,
  ) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        const response = await tx.execute(taskFailureQuery(input, observation.samples, target));
        const record = z
          .object({
            observed_at: z.coerce.date(),
            total: z.coerce.number().int().nonnegative(),
            items: z.array(taskFailureRecordSchema),
            unmatched: z.coerce.number().int().min(0).max(ADMIN_TASK_QUEUE_SAMPLE_LIMIT),
          })
          .parse(response.rows[0]);
        return AdminTaskListResponseSchema.parse({
          data: record.items.map((row) => ({
            source: row.source,
            id: row.id,
            category: row.category,
            stage: row.stage,
            errorCode: row.error_code,
            executionAttempts: row.execution_attempts,
            dispatchAttempts: row.dispatch_attempts,
            createdAt: row.created_at.toISOString(),
            eventId: row.event_id,
            version: taskFailureVersion(row),
          })),
          meta: {
            page: input.page,
            pageSize: 20,
            total: record.total,
            observedAt: record.observed_at.toISOString(),
            queueObservation: {
              ...observation.meta,
              status:
                observation.meta.status === 'ready' && record.unmatched
                  ? 'partial'
                  : observation.meta.status,
              unverifiable: observation.meta.unverifiable + record.unmatched,
            },
          },
        });
      },
      // 行锁内复查身份；列表和总数由同一SQL语句快照产生
      { area: 'content' },
    );
  }
  async detail(
    actor: Identity,
    target: AdminTaskPath,
    observation: Awaited<ReturnType<typeof inspectFailedQueueTasks>>,
  ) {
    const result = await this.list(
      actor,
      { page: 1, category: 'all', stage: 'all' },
      observation,
      target,
    );
    return AdminTaskDetailResponseSchema.parse({
      data: result.data[0] ?? null,
      meta: { observedAt: result.meta.observedAt, queueObservation: result.meta.queueObservation },
    });
  }
}
