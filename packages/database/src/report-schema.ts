import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  jsonb,
  boolean,
  check,
  index,
  uniqueIndex,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { users } from './auth-schema.js';
import { personas } from './persona-schema.js';
import { personaReleases } from './release-schema.js';
import { comments, commentRevisions } from './comment-schema.js';
import { profileSubmissions } from './profile-schema.js';
const statuses = ['pending', 'processing', 'resolved', 'dismissed'] as const;
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => users.id),
    reportedUserId: uuid('reported_user_id')
      .notNull()
      .references(() => users.id),
    type: varchar('type', { length: 16, enum: ['persona', 'comment', 'profile'] }).notNull(),
    targetId: uuid('target_id').notNull(),
    targetRevisionId: uuid('target_revision_id').notNull(),
    personaId: uuid('persona_id').references(() => personas.id),
    releaseId: uuid('release_id'),
    profileUserId: uuid('profile_user_id'),
    profileSubmissionId: uuid('profile_submission_id'),
    commentId: uuid('comment_id'),
    commentRevisionId: uuid('comment_revision_id'),
    targetTitle: varchar('target_title', { length: 80 }).notNull(),
    reason: varchar('reason', {
      length: 32,
      enum: ['copyright', 'inappropriate', 'spam', 'other'],
    }).notNull(),
    details: text('details').default('').notNull(),
    snapshot: jsonb('snapshot').$type<unknown>().notNull(),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    status: varchar('status', { length: 16, enum: statuses }).default('pending').notNull(),
    revision: integer('revision').default(1).notNull(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.profileUserId, table.profileSubmissionId],
      foreignColumns: [profileSubmissions.userId, profileSubmissions.id],
      name: 'reports_profile_submission_owner_fk',
    }),
    foreignKey({
      columns: [table.personaId, table.releaseId],
      foreignColumns: [personaReleases.personaId, personaReleases.id],
      name: 'reports_release_owner_fk',
    }),
    foreignKey({
      columns: [table.personaId, table.commentId],
      foreignColumns: [comments.personaId, comments.id],
      name: 'reports_comment_persona_fk',
    }),
    foreignKey({
      columns: [table.commentId, table.commentRevisionId],
      foreignColumns: [commentRevisions.commentId, commentRevisions.id],
      name: 'reports_comment_revision_fk',
    }),
    check(
      'reports_target_shape',
      sql`(${table.type}='persona' AND ${table.personaId} IS NOT NULL AND ${table.releaseId} IS NOT NULL AND ${table.targetId}=${table.personaId} AND ${table.targetRevisionId}=${table.releaseId} AND ${table.commentId} IS NULL AND ${table.commentRevisionId} IS NULL AND ${table.profileUserId} IS NULL AND ${table.profileSubmissionId} IS NULL) OR (${table.type}='comment' AND ${table.personaId} IS NOT NULL AND ${table.releaseId} IS NOT NULL AND ${table.commentId} IS NOT NULL AND ${table.commentRevisionId} IS NOT NULL AND ${table.targetId}=${table.commentId} AND ${table.targetRevisionId}=${table.commentRevisionId} AND ${table.profileUserId} IS NULL AND ${table.profileSubmissionId} IS NULL) OR (${table.type}='profile' AND ${table.profileUserId} IS NOT NULL AND ${table.profileSubmissionId} IS NOT NULL AND ${table.reportedUserId}=${table.profileUserId} AND ${table.targetId}=${table.profileUserId} AND ${table.targetRevisionId}=${table.profileSubmissionId} AND ${table.personaId} IS NULL AND ${table.releaseId} IS NULL AND ${table.commentId} IS NULL AND ${table.commentRevisionId} IS NULL)`,
    ),
    check(
      'reports_status_valid',
      sql`${table.status} IN ('pending','processing','resolved','dismissed')`,
    ),
    check(
      'reports_reason_valid',
      sql`${table.reason} IN ('copyright','inappropriate','spam','other')`,
    ),
    check('reports_revision_positive', sql`${table.revision}>0`),
    check('reports_details_bounded', sql`char_length(${table.details})<=5000`),
    check(
      'reports_title_bounded',
      sql`char_length(${table.targetTitle}) BETWEEN (CASE WHEN ${table.type}='profile' THEN 1 ELSE 2 END) AND 80 AND ${table.targetTitle} ~ '[^[:space:]]'`,
    ),
    check(
      'reports_snapshot_shape',
      sql`jsonb_typeof(${table.snapshot})='object' AND ${table.snapshot} ? 'type' AND ${table.snapshot} ? 'title' AND jsonb_typeof(${table.snapshot}->'type')='string' AND jsonb_typeof(${table.snapshot}->'title')='string' AND ${table.snapshot}->>'type'=${table.type} AND ${table.snapshot}->>'title'=${table.targetTitle} AND octet_length(${table.snapshot}::text)<=(CASE WHEN ${table.type}='profile' THEN 32768 ELSE 16000 END)`,
    ),
    check('reports_hash_valid', sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`),
    uniqueIndex('reports_active_actor_target_unique')
      .on(table.reporterId, table.type, table.targetId, table.targetRevisionId)
      .where(sql`${table.status} IN ('pending','processing')`),
    index('reports_reporter_created_idx').on(
      table.reporterId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index('reports_queue_created_idx').on(table.status, table.createdAt.desc(), table.id.desc()),
    index('reports_target_recent_idx').on(
      table.reporterId,
      table.type,
      table.targetId,
      table.targetRevisionId,
      table.createdAt.desc(),
    ),
  ],
);
export const reportActions = pgTable(
  'report_actions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => reports.id),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    action: varchar('action', {
      length: 16,
      enum: ['submitted', 'accepted', 'resolved', 'dismissed', 'noted'],
    }).notNull(),
    message: text('message').default('').notNull(),
    privateNote: text('private_note').default('').notNull(),
    beforeStatus: varchar('before_status', { length: 16, enum: statuses }),
    afterStatus: varchar('after_status', { length: 16, enum: statuses }).notNull(),
    fromRevision: integer('from_revision').notNull(),
    toRevision: integer('to_revision').notNull(),
    selfReview: boolean('self_review').default(false).notNull(),
    requestId: uuid('request_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      'report_actions_action_valid',
      sql`${table.action} IN ('submitted','accepted','resolved','dismissed','noted')`,
    ),
    check(
      'report_actions_status_valid',
      sql`(${table.beforeStatus} IS NULL OR ${table.beforeStatus} IN ('pending','processing','resolved','dismissed')) AND ${table.afterStatus} IN ('pending','processing','resolved','dismissed')`,
    ),
    check(
      'report_actions_revision_step',
      sql`${table.fromRevision}>=0 AND ${table.toRevision}=${table.fromRevision}+1`,
    ),
    check(
      'report_actions_transition',
      sql`(${table.action}='submitted' AND ${table.beforeStatus} IS NULL AND ${table.afterStatus}='pending') OR (${table.action}='accepted' AND ${table.beforeStatus}='pending' AND ${table.afterStatus}='processing') OR (${table.action}='resolved' AND ${table.beforeStatus} IN ('pending','processing') AND ${table.afterStatus}='resolved') OR (${table.action}='dismissed' AND ${table.beforeStatus} IN ('pending','processing') AND ${table.afterStatus}='dismissed') OR (${table.action}='noted' AND ${table.beforeStatus}=${table.afterStatus})`,
    ),
    check(
      'report_actions_text_bounded',
      sql`char_length(${table.message})<=2000 AND char_length(${table.privateNote})<=5000`,
    ),
    check(
      'report_actions_shape',
      sql`(${table.action}='submitted' AND ${table.beforeStatus} IS NULL AND ${table.afterStatus}='pending' AND ${table.fromRevision}=0 AND NOT ${table.selfReview}) OR (${table.action}<>'submitted' AND ${table.beforeStatus} IS NOT NULL AND ${table.fromRevision}>0 AND ((${table.action}='noted' AND (${table.message} ~ '[^[:space:]]' OR ${table.privateNote} ~ '[^[:space:]]')) OR (${table.action}<>'noted' AND ${table.message} ~ '[^[:space:]]')))`,
    ),
    uniqueIndex('report_actions_revision_unique').on(table.reportId, table.toRevision),
    index('report_actions_history_idx').on(table.reportId, table.createdAt.desc(), table.id.desc()),
  ],
);

// 追加式的处置凭据与举报动作同事务写入；不改写原始举报或旧处理记录
export const reportResolutions = pgTable(
  'report_resolutions',
  {
    actionId: uuid('action_id')
      .primaryKey()
      .references(() => reportActions.id),
    command: jsonb('command').$type<unknown>().notNull(),
    result: jsonb('result').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table) => [
    check(
      'report_resolution_command_shape',
      sql`jsonb_typeof(${table.command})='object' AND ${table.command} ? 'reason' AND jsonb_typeof(${table.command}->'reason')='string' AND char_length(${table.command}->>'reason') BETWEEN 1 AND 2000 AND ${table.command}->>'reason' ~ '[^[:space:]]' AND octet_length(${table.command}::text)<=16000`,
    ),
    check(
      'report_resolution_result_shape',
      sql`jsonb_typeof(${table.result})='object' AND ${table.result} ? 'content' AND ${table.result} ? 'account' AND octet_length(${table.result}::text)<=4000`,
    ),
  ],
);
