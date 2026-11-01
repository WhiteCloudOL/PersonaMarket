import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './auth-schema.js';
import { assets } from './asset-schema.js';

export const profileDrafts = pgTable(
  'profile_drafts',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id),
    revision: integer('revision').default(1).notNull(),
    displayName: varchar('display_name', { length: 60 }).notNull(),
    bio: text('bio').default('').notNull(),
    avatarAssetId: uuid('avatar_asset_id').references(() => assets.id),
    links: jsonb('links')
      .$type<unknown>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table) => [
    check('profile_draft_revision_positive', sql`${table.revision}>0`),
    check(
      'profile_draft_name_bounded',
      sql`char_length(${table.displayName}) BETWEEN 1 AND 60 AND ${table.displayName}=btrim(${table.displayName}) AND ${table.displayName} !~ '[[:cntrl:]]' AND ${table.displayName} ~ '[^[:space:]]'`,
    ),
    check('profile_draft_bio_bounded', sql`char_length(${table.bio})<=1000`),
    check(
      'profile_draft_links_bounded',
      sql`CASE WHEN jsonb_typeof(${table.links})='array' THEN jsonb_array_length(${table.links})<=5 AND octet_length(${table.links}::text)<=20000 ELSE false END`,
    ),
  ],
);

export const profileSubmissions = pgTable(
  'profile_submissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    draftRevision: integer('draft_revision').notNull(),
    displayName: varchar('display_name', { length: 60 }).notNull(),
    bio: text('bio').default('').notNull(),
    avatarAssetId: uuid('avatar_asset_id').references(() => assets.id),
    links: jsonb('links')
      .$type<unknown>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    status: varchar('status', {
      length: 16,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'],
    })
      .default('PENDING')
      .notNull(),
    revision: integer('revision').default(1).notNull(),
    reason: text('reason'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table) => [
    uniqueIndex('profile_submission_owner_unique').on(table.userId, table.id),
    uniqueIndex('one_pending_profile_per_owner')
      .on(table.userId)
      .where(sql`${table.status}='PENDING'`),
    index('profile_submission_owner_created_idx').on(
      table.userId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index('profile_submission_queue_idx')
      .on(table.createdAt, table.id)
      .where(sql`${table.status}='PENDING'`),
    check(
      'profile_submission_revision_positive',
      sql`${table.revision}>0 AND ${table.draftRevision}>0`,
    ),
    check(
      'profile_submission_name_bounded',
      sql`char_length(${table.displayName}) BETWEEN 1 AND 60 AND ${table.displayName}=btrim(${table.displayName}) AND ${table.displayName} !~ '[[:cntrl:]]' AND ${table.displayName} ~ '[^[:space:]]'`,
    ),
    check('profile_submission_bio_bounded', sql`char_length(${table.bio})<=1000`),
    check(
      'profile_submission_links_bounded',
      sql`CASE WHEN jsonb_typeof(${table.links})='array' THEN jsonb_array_length(${table.links})<=5 AND octet_length(${table.links}::text)<=20000 ELSE false END`,
    ),
    check('profile_submission_hash_valid', sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`),
    check(
      'profile_submission_status_valid',
      sql`${table.status} IN ('PENDING','APPROVED','REJECTED','WITHDRAWN')`,
    ),
    check(
      'profile_submission_decision_shape',
      sql`(${table.status}='PENDING' AND ${table.reason} IS NULL AND ${table.reviewedBy} IS NULL AND ${table.reviewedAt} IS NULL AND ${table.withdrawnAt} IS NULL) OR (${table.status} IN ('APPROVED','REJECTED') AND ${table.reason} IS NOT NULL AND char_length(${table.reason})<=2000 AND ${table.reviewedBy} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL AND ${table.withdrawnAt} IS NULL AND (${table.status}<>'REJECTED' OR ${table.reason} ~ '[^[:space:]]')) OR (${table.status}='WITHDRAWN' AND ${table.reason} IS NULL AND ${table.reviewedBy} IS NULL AND ${table.reviewedAt} IS NULL AND ${table.withdrawnAt} IS NOT NULL)`,
    ),
  ],
);

export const userProfiles = pgTable(
  'user_profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id),
    visibility: varchar('visibility', { length: 16, enum: ['normal', 'hidden'] })
      .default('normal')
      .notNull(),
    revision: integer('revision').default(1).notNull(),
    publishedSubmissionId: uuid('published_submission_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`clock_timestamp()`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId, table.publishedSubmissionId],
      foreignColumns: [profileSubmissions.userId, profileSubmissions.id],
      name: 'profile_published_submission_owner_fk',
    }),
    check('user_profile_revision_positive', sql`${table.revision}>0`),
    check('user_profile_visibility_valid', sql`${table.visibility} IN ('normal','hidden')`),
  ],
);

export const profileRecords = pgTable(
  'profile_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    submissionId: uuid('submission_id'),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    action: varchar('action', {
      length: 16,
      enum: ['submit', 'withdraw', 'approve', 'reject', 'hide', 'restore'],
    }).notNull(),
    reason: text('reason').default('').notNull(),
    selfReview: boolean('self_review').default(false).notNull(),
    fromProfileRevision: integer('from_profile_revision').notNull(),
    toProfileRevision: integer('to_profile_revision').notNull(),
    requestId: uuid('request_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId, table.submissionId],
      foreignColumns: [profileSubmissions.userId, profileSubmissions.id],
      name: 'profile_record_submission_owner_fk',
    }),
    check(
      'profile_record_action_valid',
      sql`${table.action} IN ('submit','withdraw','approve','reject','hide','restore')`,
    ),
    check(
      'profile_record_reason_bounded',
      sql`char_length(${table.reason})<=2000 AND (${table.action} NOT IN ('reject','hide','restore') OR ${table.reason} ~ '[^[:space:]]') AND (NOT ${table.selfReview} OR ${table.reason} ~ '[^[:space:]]')`,
    ),
    check(
      'profile_record_revision_shape',
      sql`${table.fromProfileRevision}>0 AND ((${table.action} IN ('submit','withdraw','reject') AND ${table.toProfileRevision}=${table.fromProfileRevision}) OR (${table.action} IN ('approve','hide','restore') AND ${table.toProfileRevision}=${table.fromProfileRevision}+1))`,
    ),
    check(
      'profile_record_submission_required',
      sql`${table.action} IN ('hide','restore') OR ${table.submissionId} IS NOT NULL`,
    ),
    check(
      'profile_record_owner_action',
      sql`${table.action} NOT IN ('submit','withdraw') OR (${table.actorId}=${table.userId} AND NOT ${table.selfReview})`,
    ),
    uniqueIndex('profile_record_submission_action_unique')
      .on(table.submissionId, table.action)
      .where(sql`${table.action} IN ('submit','withdraw','approve','reject')`),
    uniqueIndex('profile_record_state_revision_unique')
      .on(table.userId, table.toProfileRevision)
      .where(sql`${table.action} IN ('approve','hide','restore')`),
    index('profile_record_owner_created_idx').on(
      table.userId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);
