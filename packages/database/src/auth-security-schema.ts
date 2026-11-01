import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  bigint,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './auth-schema.js';

export const userMfa = pgTable('user_mfa', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  encryptedSecret: text('encrypted_secret').notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  pendingExpiresAt: timestamp('pending_expires_at', { withTimezone: true }).notNull(),
  lastCounter: bigint('last_counter', { mode: 'number' }).default(-1).notNull(),
});
export const mfaRecoveryCodes = pgTable(
  'mfa_recovery_codes',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.codeHash] })],
);
export const authAuditEvents = pgTable(
  'auth_audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    event: varchar('event', { length: 80 }).notNull(),
    requestId: uuid('request_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('auth_audit_user_created_idx').on(table.userId, table.createdAt)],
);
