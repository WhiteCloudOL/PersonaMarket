import { sql } from 'drizzle-orm';
import {
  pgTable,
  varchar,
  text,
  integer,
  uuid,
  timestamp,
  jsonb,
  check,
  index,
  uniqueIndex,
  foreignKey,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { users } from './auth-schema.js';
const guideSlugs = [
  'getting-started',
  'maibot',
  'astrbot',
  'create-draft',
  'images-readme',
  'source-license',
  'publish',
  'import-files',
  'troubleshooting',
] as const;

export const guideEntries = pgTable(
  'guide_entries',
  {
    slug: varchar('slug', { length: 32, enum: guideSlugs }).primaryKey(),
    title: varchar('title', { length: 160 }).notNull(),
    summary: varchar('summary', { length: 300 }).notNull(),
    bodyMarkdown: text('body_markdown').notNull(),
    status: varchar('status', { length: 16, enum: ['draft', 'published', 'withdrawn'] })
      .default('draft')
      .notNull(),
    revision: integer('revision').default(1).notNull(),
    publishedId: uuid('published_id'),
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      'guide_entries_slug_valid',
      sql`${table.slug} IN ('getting-started','maibot','astrbot','create-draft','images-readme','source-license','publish','import-files','troubleshooting')`,
    ),
    check('guide_entries_revision_positive', sql`${table.revision}>0`),
    check('guide_entries_title_not_empty', sql`char_length(${table.title})>=1`),
    check(
      'guide_entries_body_bounded',
      sql`char_length(${table.bodyMarkdown}) BETWEEN 1 AND 30000`,
    ),
    check(
      'guide_entries_status_pointer',
      sql`(${table.status}='draft' AND ${table.publishedId} IS NULL) OR (${table.status} IN ('published','withdrawn') AND ${table.publishedId} IS NOT NULL)`,
    ),
    foreignKey({
      columns: [table.slug, table.publishedId],
      foreignColumns: [guidePublications.slug, guidePublications.id],
      name: 'guide_entries_publication_owner_fk',
    }),
  ],
);

export const guidePublications = pgTable(
  'guide_publications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: varchar('slug', { length: 32, enum: guideSlugs })
      .notNull()
      .references((): AnyPgColumn => guideEntries.slug),
    title: varchar('title', { length: 160 }).notNull(),
    summary: varchar('summary', { length: 300 }).notNull(),
    bodyMarkdown: text('body_markdown').notNull(),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    actorId: uuid('actor_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('guide_publications_slug_id_unique').on(table.slug, table.id),
    check('guide_publications_title_not_empty', sql`char_length(${table.title})>=1`),
    check(
      'guide_publications_body_bounded',
      sql`char_length(${table.bodyMarkdown}) BETWEEN 1 AND 30000`,
    ),
    check('guide_publications_hash_valid', sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`),
    index('guide_publications_slug_created_idx').on(
      table.slug,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);

export const guideRecords = pgTable(
  'guide_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: varchar('slug', { length: 32, enum: guideSlugs })
      .notNull()
      .references(() => guideEntries.slug),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    action: varchar('action', { length: 16, enum: ['edited', 'published', 'withdrawn'] }).notNull(),
    reason: varchar('reason', { length: 2000 }).notNull(),
    beforeState: jsonb('before_state').$type<unknown>().notNull(),
    afterState: jsonb('after_state').$type<unknown>().notNull(),
    fromRevision: integer('from_revision').notNull(),
    toRevision: integer('to_revision').notNull(),
    requestId: text('request_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('guide_records_action_valid', sql`${table.action} IN ('edited','published','withdrawn')`),
    check('guide_records_before_object', sql`jsonb_typeof(${table.beforeState})='object'`),
    check('guide_records_after_object', sql`jsonb_typeof(${table.afterState})='object'`),
    check(
      'guide_records_revision_step',
      sql`${table.fromRevision}>0 AND ${table.toRevision}=${table.fromRevision}+1`,
    ),
    uniqueIndex('guide_records_slug_revision_unique').on(table.slug, table.toRevision),
    index('guide_records_slug_created_idx').on(table.slug, table.createdAt.desc(), table.id.desc()),
  ],
);
