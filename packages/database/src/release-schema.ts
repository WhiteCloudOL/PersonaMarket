import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  jsonb,
  timestamp,
  boolean,
  check,
  index,
  uniqueIndex,
  foreignKey,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { personas } from './persona-schema.js';
import { users } from './auth-schema.js';
export const personaReleases = pgTable(
  'persona_releases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    personaId: uuid('persona_id')
      .notNull()
      .references(() => personas.id),
    version: varchar('version', { length: 32 }).notNull(),
    major: integer('major').notNull(),
    minor: integer('minor').notNull(),
    patch: integer('patch').notNull(),
    lifecycle: varchar('lifecycle', {
      length: 16,
      enum: ['UNPUBLISHED', 'PUBLISHED', 'WITHDRAWN', 'BLOCKED'],
    })
      .default('UNPUBLISHED')
      .notNull(),
    approvedSubmissionId: uuid('approved_submission_id'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    moderationRevision: integer('moderation_revision').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check('release_moderation_revision_positive', sql`${t.moderationRevision}>0`),
    uniqueIndex('release_persona_version_unique').on(t.personaId, t.version),
    uniqueIndex('release_persona_id_unique').on(t.personaId, t.id),
    check(
      'release_version_valid',
      sql`${t.major} BETWEEN 0 AND 999999 AND ${t.minor} BETWEEN 0 AND 999999 AND ${t.patch} BETWEEN 0 AND 999999 AND ${t.version}=${t.major}::text||'.'||${t.minor}::text||'.'||${t.patch}::text`,
    ),
    check(
      'release_lifecycle_valid',
      sql`${t.lifecycle} IN ('UNPUBLISHED','PUBLISHED','WITHDRAWN','BLOCKED')`,
    ),
    check(
      'release_published_shape',
      sql`(${t.publishedAt} IS NULL AND ${t.approvedSubmissionId} IS NULL AND ${t.lifecycle}='UNPUBLISHED') OR (${t.publishedAt} IS NOT NULL AND ${t.approvedSubmissionId} IS NOT NULL AND ${t.lifecycle}<>'UNPUBLISHED')`,
    ),
  ],
);
export const releaseSubmissions = pgTable(
  'release_submissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    personaId: uuid('persona_id')
      .notNull()
      .references(() => personas.id),
    releaseId: uuid('release_id').notNull(),
    submittedBy: uuid('submitted_by')
      .notNull()
      .references(() => users.id),
    attemptNumber: integer('attempt_number').notNull(),
    snapshot: jsonb('snapshot').$type<unknown>().notNull(),
    publication: jsonb('publication').$type<unknown>().notNull(),
    changelog: text('changelog').notNull(),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    status: varchar('status', {
      length: 16,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'],
    })
      .default('PENDING')
      .notNull(),
    revision: integer('revision').default(1).notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.personaId, t.releaseId],
      foreignColumns: [personaReleases.personaId, personaReleases.id],
      name: 'submission_release_owner_fk',
    }),
    uniqueIndex('submission_attempt_unique').on(t.releaseId, t.attemptNumber),
    uniqueIndex('submission_persona_id_release_unique').on(t.personaId, t.id, t.releaseId),
    uniqueIndex('one_pending_per_persona')
      .on(t.personaId)
      .where(sql`${t.status}='PENDING'`),
    check(
      'submission_status_valid',
      sql`${t.status} IN ('PENDING','APPROVED','REJECTED','WITHDRAWN')`,
    ),
    check(
      'submission_bounds',
      sql`${t.attemptNumber}>0 AND ${t.revision}>0 AND octet_length(${t.snapshot}::text)<=4194304 AND char_length(${t.changelog}) <= 5000`,
    ),
    index('submission_queue_idx').on(t.status, t.createdAt),
    index('submission_persona_created_idx').on(t.personaId, t.createdAt, t.id),
  ],
);
export const moderationRecords = pgTable(
  'moderation_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    personaId: uuid('persona_id')
      .notNull()
      .references(() => personas.id),
    submissionId: uuid('submission_id').references(() => releaseSubmissions.id),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    action: varchar('action', { length: 64 }).notNull(),
    reason: text('reason').notNull(),
    selfReview: boolean('self_review').default(false).notNull(),
    requestId: uuid('request_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('moderation_persona_idx').on(t.personaId, t.createdAt)],
);
export const personaPublicProjection = pgTable(
  'persona_public_projection',
  {
    personaId: uuid('persona_id')
      .primaryKey()
      .references(() => personas.id),
    releaseId: uuid('release_id').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    readmeText: text('readme_text').notNull(),
    searchReleaseId: uuid('search_release_id'),
    searchText: text('search_text').default('').notNull(),
    publisherName: text('publisher_name').default('').notNull(),
    authorNames: text('author_names').default('').notNull(),
    tagNames: text('tag_names')
      .array()
      .default(sql`'{}'::text[]`)
      .notNull(),
    modelNames: text('model_names').default('').notNull(),
    categoryId: uuid('category_id'),
    tagIds: uuid('tag_ids')
      .array()
      .default(sql`'{}'::uuid[]`)
      .notNull(),
    platform: varchar('platform', { length: 16, enum: ['maibot', 'astrbot'] }),
    originType: varchar('origin_type', { length: 16, enum: ['original', 'repost'] }),
    redistribution: varchar('redistribution', {
      length: 32,
      enum: ['not_allowed', 'attribution_required', 'contact_required', 'custom'],
    }),
    dialogueCount: integer('dialogue_count').default(0).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.personaId, t.releaseId],
      foreignColumns: [personaReleases.personaId, personaReleases.id],
      name: 'projection_release_owner_fk',
    }),
    index('projection_search_trgm_idx').using('gin', t.searchText.op('gin_trgm_ops')),
    index('projection_tags_idx').using('gin', t.tagIds),
    index('projection_platform_category_idx').on(t.platform, t.categoryId),
    check(
      'projection_search_bounds',
      sql`char_length(${t.searchText})<=40000 AND ${t.dialogueCount} BETWEEN 0 AND 100 AND cardinality(${t.tagIds})<=8 AND cardinality(${t.tagNames})<=8`,
    ),
    check(
      'projection_search_ready',
      sql`${t.searchReleaseId} IS NULL OR (${t.categoryId} IS NOT NULL AND ${t.platform} IS NOT NULL AND ${t.originType} IS NOT NULL AND ${t.redistribution} IS NOT NULL)`,
    ),
  ],
);
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    operation: varchar('operation', { length: 100 }).notNull(),
    key: uuid('key').notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    resultId: uuid('result_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.actorId, t.operation, t.key] })],
);
