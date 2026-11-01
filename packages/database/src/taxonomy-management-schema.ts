import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, text, jsonb, timestamp, index, check } from 'drizzle-orm/pg-core';
import { users } from './auth-schema.js';

export const taxonomyManagementRecords = pgTable(
  'taxonomy_management_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    kind: varchar('kind', { length: 16, enum: ['category', 'tag'] }).notNull(),
    entityId: uuid('entity_id').notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    action: varchar('action', {
      length: 16,
      enum: ['created', 'updated', 'archived', 'restored'],
    }).notNull(),
    reason: varchar('reason', { length: 2000 }).notNull(),
    beforeState: jsonb('before_state').$type<unknown>(),
    afterState: jsonb('after_state').$type<unknown>().notNull(),
    requestId: text('request_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('taxonomy_management_entity_created_idx').on(
      table.kind,
      table.entityId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    check('taxonomy_management_kind_valid', sql`${table.kind} IN ('category','tag')`),
    check(
      'taxonomy_management_action_valid',
      sql`${table.action} IN ('created','updated','archived','restored')`,
    ),
    check('taxonomy_management_after_object', sql`jsonb_typeof(${table.afterState})='object'`),
    check(
      'taxonomy_management_before_valid',
      sql`(${table.action}='created' AND ${table.beforeState} IS NULL) OR (${table.action}<>'created' AND ${table.beforeState} IS NOT NULL AND jsonb_typeof(${table.beforeState})='object')`,
    ),
  ],
);
