import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  integer,
  boolean,
  check,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './auth-schema.js';
import { outboxEvents } from './outbox-schema.js';

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id),
    actorId: uuid('actor_id').references(() => users.id),
    sourceId: uuid('source_id').notNull(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => outboxEvents.id),
    kind: varchar('kind', {
      length: 32,
      enum: [
        'release_approved',
        'release_rejected',
        'comment_approved',
        'comment_rejected',
        'comment_state',
        'comment_reply',
        'persona_state',
        'profile_approved',
        'profile_rejected',
        'profile_state',
        'report_updated',
        'account_security',
        'admin_notice',
      ],
    }).notNull(),
    title: varchar('title', { length: 120 }).notNull(),
    message: text('message').notNull(),
    target: jsonb('target').$type<unknown>().notNull(),
    status: varchar('status', { length: 16, enum: ['queued', 'delivered', 'skipped', 'failed'] })
      .default('queued')
      .notNull(),
    revision: integer('revision').default(1).notNull(),
    attempts: integer('attempts').default(0).notNull(),
    errorCode: varchar('error_code', {
      length: 32,
      enum: ['DELIVERY_FAILED', 'TARGET_UNAVAILABLE'],
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`clock_timestamp()`)
      .notNull(),
    lastAttemptedAt: timestamp('last_attempted_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('notifications_business_event_unique').on(
      table.recipientId,
      table.kind,
      table.sourceId,
    ),
    uniqueIndex('notifications_outbox_unique').on(table.eventId),
    index('notifications_inbox_idx')
      .on(table.recipientId, table.deliveredAt.desc(), table.id.desc())
      .where(sql`${table.status}='delivered'`),
    index('notifications_unread_idx')
      .on(table.recipientId)
      .where(sql`${table.status}='delivered' AND ${table.readAt} IS NULL`),
    index('notifications_admin_notice_idx')
      .on(table.createdAt.desc(), table.id.desc())
      .where(sql`${table.kind}='admin_notice'`),
    index('notifications_queued_idx')
      .on(table.createdAt, table.id)
      .where(sql`${table.status}='queued'`),
    index('notifications_failed_idx')
      .on(table.createdAt, table.id)
      .where(sql`${table.status}='failed'`),
    check(
      'notifications_kind_valid',
      sql`${table.kind} IN ('release_approved','release_rejected','comment_approved','comment_rejected','comment_state','comment_reply','persona_state','profile_approved','profile_rejected','profile_state','report_updated','account_security','admin_notice')`,
    ),
    check(
      'notifications_text_bounded',
      sql`char_length(${table.title}) BETWEEN 2 AND 120 AND ${table.title} ~ '[^[:space:]]' AND char_length(${table.message}) BETWEEN 1 AND 2000 AND ${table.message} ~ '[^[:space:]]'`,
    ),
    check(
      'notifications_actor_shape',
      sql`${table.kind}<>'admin_notice' OR ${table.actorId} IS NOT NULL`,
    ),
    check(
      'notifications_target_shape',
      sql`jsonb_typeof(${table.target})='object' AND ${table.target} ? 'type' AND jsonb_typeof(${table.target}->'type')='string' AND octet_length(${table.target}::text)<=2000 AND (
    (${table.kind} IN ('release_approved','release_rejected','persona_state') AND ${table.target}->>'type'='own_persona') OR
    (${table.kind} IN ('comment_approved','comment_rejected','comment_state') AND ${table.target}->>'type'='own_comment') OR
    (${table.kind}='comment_reply' AND ${table.target}->>'type'='public_comment') OR
    (${table.kind}='report_updated' AND ${table.target}->>'type'='own_report') OR
    (${table.kind} IN ('profile_approved','profile_rejected','profile_state') AND ${table.target}->>'type'='own_profile') OR
    (${table.kind}='account_security' AND ${table.target}->>'type'='account') OR
    (${table.kind}='admin_notice' AND ${table.target}->>'type'='none'))`,
    ),
    check(
      'notifications_delivery_shape',
      sql`${table.revision}>0 AND ${table.attempts} BETWEEN 0 AND 5 AND (${table.errorCode} IS NULL OR ${table.errorCode} IN ('DELIVERY_FAILED','TARGET_UNAVAILABLE')) AND (
    (${table.status}='queued' AND ${table.deliveredAt} IS NULL AND ${table.completedAt} IS NULL AND ${table.readAt} IS NULL) OR
    (${table.status}='delivered' AND ${table.deliveredAt} IS NOT NULL AND ${table.completedAt} IS NOT NULL AND ${table.errorCode} IS NULL AND ${table.attempts}>0) OR
    (${table.status}='skipped' AND ${table.deliveredAt} IS NULL AND ${table.completedAt} IS NOT NULL AND ${table.readAt} IS NULL AND ${table.errorCode}='TARGET_UNAVAILABLE' AND ${table.attempts}>0) OR
    (${table.status}='failed' AND ${table.deliveredAt} IS NULL AND ${table.completedAt} IS NOT NULL AND ${table.readAt} IS NULL AND ${table.errorCode}='DELIVERY_FAILED' AND ${table.attempts}>0))`,
    ),
  ],
);

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id),
    reviewEmail: boolean('review_email').default(true).notNull(),
    revision: integer('revision').default(1).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table) => [check('notification_preferences_revision_positive', sql`${table.revision}>0`)],
);
