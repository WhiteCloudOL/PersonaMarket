import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth-schema.js';
import { personas } from './persona-schema.js';

export const personaLikes = pgTable(
  'persona_likes',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    personaId: uuid('persona_id')
      .notNull()
      .references(() => personas.id),
    active: boolean('active').default(true).notNull(),
    firstAddedAt: timestamp('first_added_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.personaId] }),
    index('persona_likes_active_persona_idx')
      .on(table.personaId)
      .where(sql`${table.active}`),
    index('persona_likes_ranking_idx')
      .on(table.personaId, table.firstAddedAt, table.userId)
      .where(sql`${table.active}`),
    check('persona_likes_timestamps', sql`${table.updatedAt} >= ${table.firstAddedAt}`),
  ],
);

export const personaFavorites = pgTable(
  'persona_favorites',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    personaId: uuid('persona_id')
      .notNull()
      .references(() => personas.id),
    active: boolean('active').default(true).notNull(),
    firstAddedAt: timestamp('first_added_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.personaId] }),
    index('persona_favorites_active_persona_idx')
      .on(table.personaId)
      .where(sql`${table.active}`),
    index('persona_favorites_ranking_idx')
      .on(table.personaId, table.firstAddedAt, table.userId)
      .where(sql`${table.active}`),
    index('persona_favorites_user_saved_idx')
      .on(table.userId, table.firstAddedAt.desc(), table.personaId.desc())
      .where(sql`${table.active}`),
    check('persona_favorites_timestamps', sql`${table.updatedAt} >= ${table.firstAddedAt}`),
  ],
);
