import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    topic: varchar('topic', { length: 100 }).notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    attempts: integer('attempts').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    lastErrorCode: text('last_error_code'),
  },
  (table) => [
    check('outbox_attempts_nonnegative', sql`${table.attempts} >= 0`),
    index('outbox_pending_idx')
      .on(table.availableAt)
      .where(sql`${table.deliveredAt} is null`),
  ],
);

export const processedEvents = pgTable(
  'processed_events',
  {
    consumer: varchar('consumer', { length: 100 }).notNull(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => outboxEvents.id),
    processedAt: timestamp('processed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.consumer, table.eventId] })],
);
