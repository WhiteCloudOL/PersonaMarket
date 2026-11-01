import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth-schema.js';
import { personas } from './persona-schema.js';

// 策展属于作品级运营元数据，独立于作者不可变的发布快照
export const personaCurations = pgTable(
  'persona_curations',
  {
    personaId: uuid('persona_id')
      .primaryKey()
      .references(() => personas.id),
    official: boolean('official').default(false).notNull(),
    featured: boolean('featured').default(false).notNull(),
    updatedById: uuid('updated_by_id')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('persona_curations_official_idx')
      .on(table.personaId)
      .where(sql`${table.official}`),
    index('persona_curations_featured_idx')
      .on(table.personaId)
      .where(sql`${table.featured}`),
  ],
);
