import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  integer,
  jsonb,
  timestamp,
  text,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { users } from './auth-schema.js';
import { siteSettings } from './site-settings-schema.js';

export const siteSettingRecords = pgTable(
  'site_setting_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: varchar('key', { length: 100 })
      .notNull()
      .references(() => siteSettings.key),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    reason: varchar('reason', { length: 2000 }).notNull(),
    beforeValue: jsonb('before_value').$type<unknown>().notNull(),
    afterValue: jsonb('after_value').$type<unknown>().notNull(),
    fromRevision: integer('from_revision').notNull(),
    toRevision: integer('to_revision').notNull(),
    requestId: text('request_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('site_setting_records_revision_unique').on(table.key, table.toRevision),
    index('site_setting_records_created_idx').on(
      table.key,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    check(
      'site_setting_records_revision_valid',
      sql`${table.fromRevision}>0 AND ${table.toRevision}=${table.fromRevision}+1`,
    ),
    check(
      'site_setting_records_values_object',
      sql`jsonb_typeof(${table.beforeValue})='object' AND jsonb_typeof(${table.afterValue})='object'`,
    ),
    check('site_setting_records_reason_not_empty', sql`char_length(${table.reason})>0`),
  ],
);
