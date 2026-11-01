import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './auth-schema.js';
import { deactivationRequests } from './account-lifecycle-schema.js';

export const deactivationDecisions = pgTable(
  'deactivation_decisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => deactivationRequests.id),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    decision: varchar('decision', { length: 16, enum: ['approve', 'reject'] }).notNull(),
    reason: text('reason').notNull(),
    fromStatus: varchar('from_status', {
      length: 16,
      enum: ['active', 'banned', 'deactivated'],
    }).notNull(),
    toStatus: varchar('to_status', {
      length: 16,
      enum: ['active', 'banned', 'deactivated'],
    }).notNull(),
    fromSecurityVersion: integer('from_security_version').notNull(),
    toSecurityVersion: integer('to_security_version').notNull(),
    revokedSessions: integer('revoked_sessions').default(0).notNull(),
    requestId: uuid('request_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('deactivation_decision_application_unique').on(table.applicationId),
    index('deactivation_decision_actor_created_idx').on(
      table.actorId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    check(
      'deactivation_decision_reason_bounded',
      sql`char_length(${table.reason}) BETWEEN 1 AND 2000 AND ${table.reason} ~ '[^[:space:]]'`,
    ),
    check('deactivation_decision_counts_valid', sql`${table.revokedSessions} >= 0`),
    check(
      'deactivation_decision_versions_positive',
      sql`${table.fromSecurityVersion} > 0 AND ${table.toSecurityVersion} > 0`,
    ),
    check(
      'deactivation_decision_status_valid',
      sql`${table.fromStatus} IN ('active','banned','deactivated') AND ${table.toStatus} IN ('active','banned','deactivated')`,
    ),
    check(
      'deactivation_decision_transition_valid',
      sql`
    (${table.decision}='approve' AND ${table.fromStatus} IN ('active','banned') AND ${table.toStatus}='deactivated' AND ${table.toSecurityVersion}=${table.fromSecurityVersion}+1)
    OR (${table.decision}='reject' AND ${table.toStatus}=${table.fromStatus} AND ${table.toSecurityVersion}=${table.fromSecurityVersion} AND ${table.revokedSessions}=0)
  `,
    ),
  ],
);
