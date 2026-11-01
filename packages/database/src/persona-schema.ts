import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  boolean,
  integer,
  timestamp,
  jsonb,
  check,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './auth-schema.js';

const taxonomyManagementColumns = () => ({
  sortOrder: integer('sort_order').default(0).notNull(),
  revision: integer('revision').default(1).notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
export const categories = pgTable(
  'categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 80 }).notNull(),
    active: boolean('active').default(true).notNull(),
    ...taxonomyManagementColumns(),
  },
  (table) => [
    uniqueIndex('categories_name_casefold_unique').on(sql`lower(${table.name})`),
    index('categories_state_order_idx').on(table.active, table.sortOrder, table.id),
    check('categories_revision_positive', sql`${table.revision}>0`),
    check('categories_sort_order_bounded', sql`${table.sortOrder} BETWEEN -10000 AND 10000`),
    check('categories_archived_inactive', sql`${table.archivedAt} IS NULL OR NOT ${table.active}`),
  ],
);
export const tags = pgTable(
  'tags',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 80 }).notNull(),
    active: boolean('active').default(true).notNull(),
    ...taxonomyManagementColumns(),
  },
  (table) => [
    uniqueIndex('tags_name_unique').on(table.name),
    uniqueIndex('tags_name_casefold_unique').on(sql`lower(${table.name})`),
    index('tags_state_order_idx').on(table.active, table.sortOrder, table.id),
    check('tags_revision_positive', sql`${table.revision}>0`),
    check('tags_sort_order_bounded', sql`${table.sortOrder} BETWEEN -10000 AND 10000`),
    check('tags_archived_inactive', sql`${table.archivedAt} IS NULL OR NOT ${table.active}`),
  ],
);
export const personas = pgTable(
  'personas',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    platform: varchar('platform', { length: 16, enum: ['maibot', 'astrbot'] }).notNull(),
    ownerVisibility: varchar('owner_visibility', { length: 16, enum: ['listed', 'hidden'] })
      .default('listed')
      .notNull(),
    moderationState: varchar('moderation_state', { length: 16, enum: ['normal', 'blocked'] })
      .default('normal')
      .notNull(),
    publishedReleaseId: uuid('published_release_id'),
    firstPublishedAt: timestamp('first_published_at', { withTimezone: true }),
    revision: integer('revision').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check('persona_platform_valid', sql`${t.platform} IN ('maibot','astrbot')`),
    check('persona_visibility_valid', sql`${t.ownerVisibility} IN ('listed','hidden')`),
    check('persona_moderation_valid', sql`${t.moderationState} IN ('normal','blocked')`),
    index('personas_owner_updated_idx').on(t.ownerId, t.updatedAt),
    index('personas_first_published_idx').on(t.firstPublishedAt.desc(), t.id.desc()),
    uniqueIndex('personas_id_owner_unique').on(t.id, t.ownerId),
  ],
);
export const personaDrafts = pgTable(
  'persona_drafts',
  {
    personaId: uuid('persona_id')
      .primaryKey()
      .references(() => personas.id),
    payload: jsonb('payload').$type<unknown>().notNull(),
    revision: integer('revision').default(1).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check('draft_revision_positive', sql`${t.revision}>0`),
    check('draft_payload_bounded', sql`octet_length(${t.payload}::text)<=4194304`),
  ],
);
