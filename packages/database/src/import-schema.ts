import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  check,
  index,
  integer,
} from 'drizzle-orm/pg-core';
import { users } from './auth-schema.js';
import { personas } from './persona-schema.js';
export const personaImports = pgTable(
  'persona_imports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    format: varchar('format', { length: 32 }).notNull(),
    inputBytes: integer('input_bytes'),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    confirmationHash: varchar('confirmation_hash', { length: 64 }),
    resultPersonaId: uuid('result_persona_id').references(() => personas.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check(
      'import_input_bytes_bounded',
      sql`${t.inputBytes} IS NULL OR ${t.inputBytes} BETWEEN 0 AND 4194304`,
    ),
    check('import_payload_bounded', sql`octet_length(${t.payload}::text)<=4194304`),
    check(
      'import_result_consistent',
      sql`(${t.consumedAt} IS NULL AND ${t.resultPersonaId} IS NULL AND ${t.confirmationHash} IS NULL) OR (${t.consumedAt} IS NOT NULL AND ${t.resultPersonaId} IS NOT NULL AND ${t.confirmationHash} IS NOT NULL)`,
    ),
    index('imports_owner_expiry_idx').on(t.ownerId, t.expiresAt),
  ],
);
