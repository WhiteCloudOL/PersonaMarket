import { sql } from 'drizzle-orm';
import { pgTable, varchar, jsonb, integer, timestamp, check } from 'drizzle-orm/pg-core';

export const siteSettings = pgTable(
  'site_settings',
  {
    key: varchar('key', { length: 100 }).primaryKey(),
    value: jsonb('value').$type<unknown>().notNull(),
    revision: integer('revision').default(1).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [check('site_settings_revision_positive', sql`${table.revision} > 0`)],
);
