import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './auth-schema.js';
export const deactivationRequests = pgTable(
  'deactivation_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: varchar('status', {
      length: 16,
      enum: ['pending', 'withdrawn', 'approved', 'rejected'],
    })
      .default('pending')
      .notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('deactivation_user_created_idx').on(
      table.userId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    uniqueIndex('deactivation_pending_user_unique')
      .on(table.userId)
      .where(sql`${table.status}='pending'`),
    check(
      'deactivation_status_valid',
      sql`${table.status} IN ('pending','withdrawn','approved','rejected')`,
    ),
    check(
      'deactivation_reason_valid',
      sql`char_length(${table.reason}) BETWEEN 1 AND 500 AND btrim(${table.reason})<>''`,
    ),
  ],
);
