import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './auth-schema.js';

/** 审计不引用可裁剪的任务/Outbox行，原任务清理后仍保留操作事实。 */
export const adminTaskRetries = pgTable(
  'admin_task_retries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    source: varchar('source', {
      length: 16,
      enum: ['dispatch', 'image', 'market_image', 'ranking', 'notification', 'mail', 'queue'],
    }).notNull(),
    taskId: uuid('task_id').notNull(),
    eventId: uuid('event_id').notNull(),
    previousEventId: uuid('previous_event_id'),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    attempt: integer('attempt').notNull(),
    expectedVersion: varchar('expected_version', { length: 64 }).notNull(),
    reason: varchar('reason', { length: 500 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    uniqueIndex('admin_task_retry_attempt_unique').on(table.source, table.taskId, table.attempt),
    uniqueIndex('admin_task_retry_version_unique').on(
      table.source,
      table.taskId,
      table.expectedVersion,
    ),
    uniqueIndex('admin_task_retry_event_unique').on(table.eventId),
    check(
      'admin_task_retry_bounds',
      sql`${table.attempt} BETWEEN 1 AND 3 AND ${table.expectedVersion} ~ '^[a-f0-9]{64}$' AND char_length(btrim(${table.reason})) BETWEEN 5 AND 500`,
    ),
    check(
      'admin_task_retry_identity',
      sql`${table.source} IN ('dispatch','image','market_image','ranking','notification','mail','queue') AND (${table.previousEventId} IS NULL OR ${table.previousEventId}<>${table.eventId})`,
    ),
  ],
);
