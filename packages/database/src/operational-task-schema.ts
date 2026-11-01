import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  check,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { outboxEvents } from './outbox-schema.js';
import { users, authTokens } from './auth-schema.js';

export const storageCleanupRuns = pgTable(
  'storage_cleanup_runs',
  {
    eventId: uuid('event_id')
      .primaryKey()
      .references(() => outboxEvents.id),
    requestId: uuid('request_id')
      .notNull()
      .references(() => outboxEvents.id),
    storageKey: varchar('storage_key', { length: 40 }).notNull(),
    manualRound: integer('manual_round').notNull().default(0),
    outcome: varchar('outcome', {
      length: 16,
      enum: ['pending', 'deleted', 'missing', 'protected', 'failed'],
    })
      .notNull()
      .default('pending'),
    executionAttempts: integer('execution_attempts').notNull().default(0),
    errorCode: varchar('error_code', { length: 32 }),
    checkedAt: timestamp('checked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    index('storage_cleanup_request_idx').on(t.requestId, t.createdAt),
    uniqueIndex('storage_cleanup_request_round_unique').on(t.requestId, t.manualRound),
    check(
      'storage_cleanup_run_shape',
      sql`${t.storageKey} ~ '^[a-f0-9]{32}[.]webp$' AND ${t.manualRound} BETWEEN 0 AND 3 AND ${t.executionAttempts} >= 0 AND ${t.outcome} IN ('pending','deleted','missing','protected','failed') AND ((${t.outcome}='pending' AND ${t.checkedAt} IS NULL AND ${t.errorCode} IS NULL) OR (${t.outcome} IN ('deleted','missing','protected') AND ${t.checkedAt} IS NOT NULL AND ${t.errorCode} IS NULL) OR (${t.outcome}='failed' AND ${t.checkedAt} IS NOT NULL AND ${t.errorCode}='STORAGE_CLEANUP_FAILED'))`,
    ),
  ],
);

/** 仅保存用途/身份及接收地址指纹，绝不保存原始验证令牌或邮件正文。旧邮件不猜补。 */
export const mailTaskContexts = pgTable(
  'mail_task_contexts',
  {
    eventId: uuid('event_id')
      .primaryKey()
      .references(() => outboxEvents.id),
    purpose: varchar('purpose', {
      length: 24,
      enum: ['email_verify', 'password_reset', 'email_change', 'security_notice', 'review_notice'],
    }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    tokenId: uuid('token_id').references(() => authTokens.id, { onDelete: 'set null' }),
    sourceId: uuid('source_id'),
    sourceType: varchar('source_type', {
      length: 24,
      enum: ['account', 'persona', 'profile_submission', 'auth_audit'],
    }).notNull(),
    recipientHash: varchar('recipient_hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    check(
      'mail_task_context_shape',
      sql`${t.purpose} IN ('email_verify','password_reset','email_change','security_notice','review_notice') AND ${t.sourceType} IN ('account','persona','profile_submission','auth_audit') AND ${t.recipientHash} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);

/** 操作事实与投递/清理结果分离；确认未知邮件不等于邮件已发送。 */
export const operationalTaskActions = pgTable(
  'operational_task_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: varchar('kind', { length: 8, enum: ['storage', 'mail'] }).notNull(),
    taskId: uuid('task_id').notNull(),
    action: varchar('action', { length: 16, enum: ['retry', 'acknowledge'] }).notNull(),
    eventId: uuid('event_id'),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    expectedVersion: varchar('expected_version', { length: 64 }).notNull(),
    reason: varchar('reason', { length: 500 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    uniqueIndex('operational_task_action_version_unique').on(t.kind, t.taskId, t.expectedVersion),
    index('operational_task_action_task_idx').on(t.kind, t.taskId, t.createdAt),
    check(
      'operational_task_action_shape',
      sql`${t.kind} IN ('storage','mail') AND ${t.action} IN ('retry','acknowledge') AND (${t.action}<>'retry' OR (${t.kind}='storage' AND ${t.eventId} IS NOT NULL)) AND ${t.expectedVersion} ~ '^[a-f0-9]{64}$' AND char_length(btrim(${t.reason})) BETWEEN 5 AND 500`,
    ),
  ],
);
