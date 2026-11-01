import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './auth-schema.js';

export const userManagementRecords = pgTable(
  'user_management_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    targetId: uuid('target_id')
      .notNull()
      .references(() => users.id),
    action: varchar('action', {
      length: 32,
      enum: ['set_role', 'ban', 'restore', 'revoke_sessions'],
    }).notNull(),
    reason: text('reason').notNull(),
    fromRole: varchar('from_role', { length: 16, enum: ['user', 'moderator', 'admin'] }).notNull(),
    toRole: varchar('to_role', { length: 16, enum: ['user', 'moderator', 'admin'] }).notNull(),
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
    scope: varchar('scope', {
      length: 32,
      enum: ['account_only', 'account_and_personas'],
    }).notNull(),
    affectedPersonas: integer('affected_personas').default(0).notNull(),
    revokedSessions: integer('revoked_sessions').default(0).notNull(),
    requestId: uuid('request_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('user_management_target_created_idx').on(t.targetId, t.createdAt.desc(), t.id.desc()),
    index('user_management_actor_created_idx').on(t.actorId, t.createdAt.desc(), t.id.desc()),
    check(
      'user_management_reason_bounded',
      sql`char_length(${t.reason}) BETWEEN 1 AND 2000 AND ${t.reason} ~ '[^[:space:]]'`,
    ),
    check(
      'user_management_versions_valid',
      sql`${t.fromSecurityVersion} > 0 AND ${t.toSecurityVersion} >= ${t.fromSecurityVersion}`,
    ),
    check(
      'user_management_counts_valid',
      sql`${t.affectedPersonas} >= 0 AND ${t.revokedSessions} >= 0`,
    ),
    check(
      'user_management_roles_valid',
      sql`${t.fromRole} IN ('user','moderator','admin') AND ${t.toRole} IN ('user','moderator','admin')`,
    ),
    check(
      'user_management_status_valid',
      sql`${t.fromStatus} IN ('active','banned','deactivated') AND ${t.toStatus} IN ('active','banned','deactivated')`,
    ),
    check(
      'user_management_scope_valid',
      sql`${t.scope} IN ('account_only','account_and_personas') AND (${t.scope}='account_only' OR ${t.action}='ban') AND (${t.affectedPersonas}=0 OR ${t.scope}='account_and_personas')`,
    ),
    check(
      'user_management_action_valid',
      sql`
      (${t.action}='set_role' AND ${t.fromStatus}=${t.toStatus})
      OR (${t.action}='ban' AND ${t.fromStatus}='active' AND ${t.toStatus}='banned' AND ${t.fromRole}=${t.toRole})
      OR (${t.action}='restore' AND ${t.fromStatus}='banned' AND ${t.toStatus}='active' AND ${t.fromRole}=${t.toRole})
      OR (${t.action}='revoke_sessions' AND ${t.fromStatus}=${t.toStatus} AND ${t.fromRole}=${t.toRole})
    `,
    ),
  ],
);
