import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { outboxEvents } from './outbox-schema.js';

export const mailDeliveries = pgTable(
  'mail_deliveries',
  {
    eventId: uuid('event_id')
      .primaryKey()
      .references(() => outboxEvents.id),
    status: varchar('status', {
      length: 16,
      enum: ['sending', 'sent', 'failed', 'uncertain'],
    }).notNull(),
    attempts: integer('attempts').notNull().default(1),
    payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
    errorCode: varchar('error_code', { length: 32 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    attemptedAt: timestamp('attempted_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'mail_delivery_bounds',
      sql`${table.attempts} BETWEEN 1 AND 5 AND ${table.payloadHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'mail_delivery_shape',
      sql`(
    (${table.status}='sending' AND ${table.errorCode} IS NULL AND ${table.completedAt} IS NULL) OR
    (${table.status}='sent' AND ${table.errorCode} IS NULL AND ${table.completedAt} IS NOT NULL) OR
    (${table.status} IN ('failed','uncertain') AND ${table.errorCode} IS NOT NULL AND ${table.errorCode} IN (
      'MAIL_SEND_FAILED','MAIL_RESULT_UNCERTAIN','MAIL_RECEIPT_UNCERTAIN','MAIL_PAYLOAD_INVALID','MAIL_NOT_CONFIGURED'
    ) AND ${table.completedAt} IS NOT NULL))`,
    ),
    index('mail_delivery_failure_idx').on(table.status, table.updatedAt),
  ],
);
