import { sql } from 'drizzle-orm';
import {
  pgTable,
  varchar,
  text,
  integer,
  uuid,
  timestamp,
  jsonb,
  boolean,
  check,
  index,
  uniqueIndex,
  foreignKey,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { users } from './auth-schema.js';
const slugs = ['terms', 'privacy', 'content-policy'] as const;

export const policyEntries = pgTable(
  'policy_entries',
  {
    slug: varchar('slug', { length: 32, enum: slugs }).primaryKey(),
    title: varchar('title', { length: 160 }).default('').notNull(),
    summary: varchar('summary', { length: 300 }).default('').notNull(),
    bodyMarkdown: text('body_markdown').default('').notNull(),
    revision: integer('revision').default(1).notNull(),
    approvedThroughRevision: integer('approved_through_revision').default(0).notNull(),
    publishedId: uuid('published_id'),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    latestSubmissionId: uuid('latest_submission_id'),
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    check('policy_entry_slug_valid', sql`${t.slug} IN ('terms','privacy','content-policy')`),
    check(
      'policy_entry_revision_valid',
      sql`${t.revision}>0 AND ${t.approvedThroughRevision}>=0 AND ${t.approvedThroughRevision}<${t.revision}`,
    ),
    check('policy_entry_body_bounded', sql`char_length(${t.bodyMarkdown})<=30000`),
    check(
      'policy_entry_public_shape',
      sql`(${t.publishedId} IS NULL AND ${t.activatedAt} IS NULL) OR (${t.publishedId} IS NOT NULL AND ${t.activatedAt} IS NOT NULL)`,
    ),
    foreignKey({
      columns: [t.slug, t.publishedId],
      foreignColumns: [policySubmissions.slug, policySubmissions.id],
      name: 'policy_entry_published_owner_fk',
    }),
    foreignKey({
      columns: [t.slug, t.latestSubmissionId],
      foreignColumns: [policySubmissions.slug, policySubmissions.id],
      name: 'policy_entry_latest_owner_fk',
    }),
  ],
);

export const policySubmissions = pgTable(
  'policy_submissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: varchar('slug', { length: 32, enum: slugs })
      .notNull()
      .references((): AnyPgColumn => policyEntries.slug),
    sourceRevision: integer('source_revision').notNull(),
    snapshot: jsonb('snapshot').$type<unknown>().notNull(),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    contributors: jsonb('contributors').$type<string[]>().notNull(),
    status: varchar('status', {
      length: 16,
      enum: ['pending', 'approved', 'rejected', 'withdrawn'],
    })
      .default('pending')
      .notNull(),
    submittedBy: uuid('submitted_by')
      .notNull()
      .references(() => users.id),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow().notNull(),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reason: text('reason'),
    selfReview: boolean('self_review').default(false).notNull(),
  },
  (t) => [
    uniqueIndex('policy_submission_owner_unique').on(t.slug, t.id),
    uniqueIndex('policy_one_pending_unique')
      .on(t.slug)
      .where(sql`${t.status}='pending'`),
    uniqueIndex('policy_approved_hash_unique')
      .on(t.slug, t.contentHash)
      .where(sql`${t.status}='approved'`),
    index('policy_submissions_recent_idx').on(t.slug, t.submittedAt.desc(), t.id.desc()),
    check('policy_submission_revision_valid', sql`${t.sourceRevision}>0`),
    check(
      'policy_submission_snapshot_valid',
      sql`jsonb_typeof(${t.snapshot})='object' AND ${t.contentHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'policy_submission_authors_valid',
      sql`CASE WHEN jsonb_typeof(${t.contributors})='array' THEN jsonb_array_length(${t.contributors})>=1 AND ${t.contributors} ? ${t.submittedBy}::text ELSE false END`,
    ),
    check(
      'policy_submission_state_valid',
      sql`
    (${t.status}='pending' AND ${t.reviewedBy} IS NULL AND ${t.reviewedAt} IS NULL AND ${t.reason} IS NULL AND NOT ${t.selfReview}) OR
    (${t.status}='withdrawn' AND ${t.reviewedBy} IS NULL AND ${t.reviewedAt} IS NULL AND ${t.reason} IS NOT NULL AND length(btrim(${t.reason}))>0 AND NOT ${t.selfReview}) OR
    (${t.status} IN ('approved','rejected') AND ${t.reviewedBy} IS NOT NULL AND ${t.reviewedAt} IS NOT NULL AND ${t.reason} IS NOT NULL
      AND (${t.status}='approved' OR length(btrim(${t.reason}))>0) AND (NOT ${t.selfReview} OR length(btrim(${t.reason}))>0))`,
    ),
    check(
      'policy_submission_reason_bounded',
      sql`${t.reason} IS NULL OR char_length(${t.reason})<=2000`,
    ),
    check(
      'policy_submission_self_review_valid',
      sql`CASE WHEN ${t.status} IN ('approved','rejected') THEN (${t.selfReview}=(${t.contributors} ? ${t.reviewedBy}::text)) IS TRUE ELSE NOT ${t.selfReview} END`,
    ),
  ],
);

export const policyRecords = pgTable(
  'policy_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: varchar('slug', { length: 32, enum: slugs })
      .notNull()
      .references(() => policyEntries.slug),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    action: varchar('action', {
      length: 16,
      enum: [
        'edited',
        'submitted',
        'approved',
        'rejected',
        'withdrawn',
        'unpublished',
        'activated',
      ],
    }).notNull(),
    submissionId: uuid('submission_id'),
    reason: text('reason').notNull(),
    selfReview: boolean('self_review').default(false).notNull(),
    beforeState: jsonb('before_state').$type<unknown>().notNull(),
    afterState: jsonb('after_state').$type<unknown>().notNull(),
    fromRevision: integer('from_revision').notNull(),
    toRevision: integer('to_revision').notNull(),
    requestId: text('request_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.slug, t.submissionId],
      foreignColumns: [policySubmissions.slug, policySubmissions.id],
      name: 'policy_record_submission_owner_fk',
    }),
    uniqueIndex('policy_record_revision_unique').on(t.slug, t.toRevision),
    index('policy_records_recent_idx').on(t.slug, t.createdAt.desc(), t.id.desc()),
    check(
      'policy_record_action_valid',
      sql`${t.action} IN ('edited','submitted','approved','rejected','withdrawn','unpublished','activated')`,
    ),
    check(
      'policy_record_states_valid',
      sql`jsonb_typeof(${t.beforeState})='object' AND jsonb_typeof(${t.afterState})='object'`,
    ),
    check(
      'policy_record_revision_step',
      sql`${t.fromRevision}>0 AND ${t.toRevision}=${t.fromRevision}+1`,
    ),
    check('policy_record_reason_bounded', sql`char_length(${t.reason})<=2000`),
  ],
);
