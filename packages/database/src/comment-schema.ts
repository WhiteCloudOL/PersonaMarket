import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './auth-schema.js';
import { personas } from './persona-schema.js';
import { personaReleases } from './release-schema.js';

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    personaId: uuid('persona_id')
      .notNull()
      .references(() => personas.id),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    parentId: uuid('parent_id'),
    replyToId: uuid('reply_to_id'),
    releaseId: uuid('release_id'),
    visibility: varchar('visibility', { length: 16, enum: ['normal', 'deleted', 'hidden'] })
      .default('normal')
      .notNull(),
    revision: integer('revision').default(1).notNull(),
    latestRevisionId: uuid('latest_revision_id'),
    publicRevisionId: uuid('public_revision_id'),
    pendingRevisionId: uuid('pending_revision_id'),
    firstPublishedAt: timestamp('first_published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('comments_persona_id_unique').on(table.personaId, table.id),
    foreignKey({
      columns: [table.personaId, table.parentId],
      foreignColumns: [table.personaId, table.id],
      name: 'comment_parent_persona_fk',
    }),
    foreignKey({
      columns: [table.personaId, table.replyToId],
      foreignColumns: [table.personaId, table.id],
      name: 'comment_reply_target_persona_fk',
    }),
    foreignKey({
      columns: [table.personaId, table.releaseId],
      foreignColumns: [personaReleases.personaId, personaReleases.id],
      name: 'comment_release_persona_fk',
    }),
    check('comment_visibility_valid', sql`${table.visibility} IN ('normal','deleted','hidden')`),
    check('comment_revision_positive', sql`${table.revision}>0`),
    check('comment_reply_shape', sql`${table.parentId} IS NOT NULL OR ${table.replyToId} IS NULL`),
    check(
      'comment_parent_not_self',
      sql`${table.parentId} IS DISTINCT FROM ${table.id} AND ${table.replyToId} IS DISTINCT FROM ${table.id}`,
    ),
    index('comments_persona_root_created_idx')
      .on(table.personaId, table.createdAt, table.id)
      .where(sql`${table.parentId} IS NULL`),
    index('comments_parent_created_idx')
      .on(table.parentId, table.createdAt, table.id)
      .where(sql`${table.parentId} IS NOT NULL`),
    index('comments_author_created_idx').on(
      table.authorId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index('comments_pending_created_idx')
      .on(table.createdAt, table.id)
      .where(sql`${table.pendingRevisionId} IS NOT NULL AND ${table.visibility}='normal'`),
  ],
);

export const commentRevisions = pgTable(
  'comment_revisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id),
    number: integer('number').notNull(),
    body: text('body').notNull(),
    status: varchar('status', {
      length: 16,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED'],
    })
      .default('PENDING')
      .notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('comment_revision_owner_unique').on(table.commentId, table.id),
    uniqueIndex('comment_revision_number_unique').on(table.commentId, table.number),
    uniqueIndex('one_pending_revision_per_comment')
      .on(table.commentId)
      .where(sql`${table.status}='PENDING'`),
    check(
      'comment_text_bounds',
      sql`${table.number}>0 AND char_length(${table.body}) BETWEEN 1 AND 2000 AND ${table.body} ~ '[^[:space:]]'`,
    ),
    check(
      'comment_revision_status_valid',
      sql`${table.status} IN ('PENDING','APPROVED','REJECTED','SUPERSEDED')`,
    ),
    check(
      'comment_reason_bounds',
      sql`${table.reason} IS NULL OR char_length(${table.reason})<=2000`,
    ),
    check(
      'comment_rejection_reason',
      sql`${table.status}<>'REJECTED' OR (${table.reason} IS NOT NULL AND ${table.reason} ~ '[^[:space:]]')`,
    ),
  ],
);

export const commentModerationRecords = pgTable(
  'comment_moderation_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id),
    revisionId: uuid('revision_id'),
    actorId: uuid('actor_id').references(() => users.id),
    action: varchar('action', {
      length: 16,
      enum: ['approve', 'reject', 'auto_approve', 'hide', 'restore', 'delete'],
    }).notNull(),
    reason: text('reason').default('').notNull(),
    selfReview: boolean('self_review').default(false).notNull(),
    requestId: uuid('request_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.commentId, table.revisionId],
      foreignColumns: [commentRevisions.commentId, commentRevisions.id],
      name: 'comment_moderation_revision_fk',
    }),
    check(
      'comment_moderation_action_valid',
      sql`${table.action} IN ('approve','reject','auto_approve','hide','restore','delete')`,
    ),
    check('comment_moderation_reason_bounds', sql`char_length(${table.reason})<=2000`),
    check(
      'comment_moderation_actor_shape',
      sql`(${table.action}='auto_approve' AND ${table.actorId} IS NULL AND NOT ${table.selfReview}) OR (${table.action}<>'auto_approve' AND ${table.actorId} IS NOT NULL)`,
    ),
    index('comment_moderation_history_idx').on(
      table.commentId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);
