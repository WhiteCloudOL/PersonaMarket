import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './auth-schema.js';

export const announcements = pgTable(
  'announcements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    title: varchar('title', { length: 160 }).notNull(),
    summary: varchar('summary', { length: 300 }).notNull(),
    body: text('body').notNull(),
    pinned: boolean('pinned').default(false).notNull(),
    status: varchar('status', { length: 16, enum: ['draft', 'published', 'withdrawn', 'archived'] })
      .default('draft')
      .notNull(),
    revision: integer('revision').default(1).notNull(),
    publishedSnapshot: jsonb('published_snapshot').$type<unknown>(),
    firstPublishedAt: timestamp('first_published_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      'announcements_status_valid',
      sql`${table.status} IN ('draft','published','withdrawn','archived')`,
    ),
    check('announcements_revision_positive', sql`${table.revision}>0`),
    check('announcements_body_bounded', sql`char_length(${table.body}) BETWEEN 1 AND 20000`),
    check('announcements_title_not_empty', sql`char_length(${table.title})>=1`),
    check(
      'announcements_snapshot_valid',
      sql`(${table.publishedSnapshot} IS NULL AND ${table.firstPublishedAt} IS NULL AND ${table.publishedAt} IS NULL AND ${table.status}<>'published') OR (${table.publishedSnapshot} IS NOT NULL AND jsonb_typeof(${table.publishedSnapshot})='object' AND ${table.firstPublishedAt} IS NOT NULL AND ${table.publishedAt} IS NOT NULL)`,
    ),
    index('announcements_status_updated_idx').on(
      table.status,
      table.updatedAt.desc(),
      table.id.desc(),
    ),
    index('announcements_published_idx')
      .on(table.publishedAt.desc(), table.id.desc())
      .where(sql`${table.status}='published'`),
  ],
);
export const announcementRecords = pgTable(
  'announcement_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    announcementId: uuid('announcement_id')
      .notNull()
      .references(() => announcements.id),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    action: varchar('action', {
      length: 16,
      enum: ['created', 'edited', 'published', 'withdrawn', 'archived', 'restored'],
    }).notNull(),
    reason: varchar('reason', { length: 2000 }).notNull(),
    beforeState: jsonb('before_state').$type<unknown>(),
    afterState: jsonb('after_state').$type<unknown>().notNull(),
    requestId: text('request_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      'announcement_records_action_valid',
      sql`${table.action} IN ('created','edited','published','withdrawn','archived','restored')`,
    ),
    check('announcement_records_after_object', sql`jsonb_typeof(${table.afterState})='object'`),
    check(
      'announcement_records_before_valid',
      sql`(${table.action}='created' AND ${table.beforeState} IS NULL) OR (${table.action}<>'created' AND ${table.beforeState} IS NOT NULL AND jsonb_typeof(${table.beforeState})='object')`,
    ),
    index('announcement_records_created_idx').on(
      table.announcementId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);
