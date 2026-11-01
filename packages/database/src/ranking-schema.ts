import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  boolean,
  doublePrecision,
  bigint,
  check,
  index,
  uniqueIndex,
  primaryKey,
  foreignKey,
  jsonb,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { personaReleases } from './release-schema.js';
import { outboxEvents } from './outbox-schema.js';

export const rankingGenerations = pgTable(
  'ranking_generations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    requestKey: varchar('request_key', { length: 96 }).notNull(),
    algorithm: varchar('algorithm', { length: 32 }).notNull(),
    settingsRevision: integer('settings_revision'),
    definition: jsonb('definition'),
    status: varchar('status', { length: 16, enum: ['pending', 'completed', 'failed'] })
      .default('pending')
      .notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    attempts: integer('attempts').default(0).notNull(),
    errorCode: varchar('error_code', { length: 64 }),
    currentEventId: uuid('current_event_id'),
  },
  (t) => [
    uniqueIndex('ranking_request_unique').on(t.requestKey),
    foreignKey({
      columns: [t.id, t.currentEventId],
      foreignColumns: [rankingGenerationRuns.generationId, rankingGenerationRuns.eventId],
      name: 'ranking_current_run_fk',
    }),
    index('ranking_latest_completed_idx')
      .on(t.generatedAt.desc(), t.id.desc())
      .where(sql`${t.status}='completed'`),
    check(
      'ranking_definition_shape',
      sql`(((${t.algorithm}='interactions-v2' AND ${t.settingsRevision}>=1 AND jsonb_typeof(${t.definition})='object'
        AND ${t.definition}->'settingsRevision'=to_jsonb(${t.settingsRevision})
        AND ${t.definition}->'halfLifeSeconds'='604800'::jsonb AND jsonb_typeof(${t.definition}->'settings')='object')
        OR (${t.algorithm} IN ('exports-v1','interactions-v1') AND ${t.settingsRevision} IS NULL AND ${t.definition} IS NULL))) IS TRUE`,
    ),
    check(
      'ranking_generation_shape',
      sql`${t.attempts} >= 0 AND ${t.algorithm} IN ('exports-v1','interactions-v1','interactions-v2') AND (
    (${t.status}='pending' AND ${t.generatedAt} IS NULL AND ${t.errorCode} IS NULL) OR
    (${t.status}='failed' AND ${t.generatedAt} IS NULL AND ${t.errorCode} IS NOT NULL) OR
    (${t.status}='completed' AND ${t.generatedAt} IS NOT NULL AND ${t.errorCode} IS NULL))`,
    ),
  ],
);

/** 每个真实Outbox一轮；旧行保持无指针，不能按历史最大attempts猜本轮事实。 */
export const rankingGenerationRuns = pgTable(
  'ranking_generation_runs',
  {
    generationId: uuid('generation_id')
      .notNull()
      .references((): AnyPgColumn => rankingGenerations.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .primaryKey()
      .references(() => outboxEvents.id),
    manualRound: integer('manual_round').notNull(),
    origin: varchar('origin', {
      length: 24,
      enum: ['created', 'legacy_adopted', 'manual_retry'],
    }).notNull(),
    state: varchar('state', { length: 16, enum: ['pending', 'retrying', 'completed', 'failed'] })
      .default('pending')
      .notNull(),
    executionAttempts: integer('execution_attempts'),
    automaticAttemptLimit: integer('automatic_attempt_limit').default(5).notNull(),
    lastAttemptedAt: timestamp('last_attempted_at', { withTimezone: true }),
    lastErrorCode: varchar('last_error_code', { length: 64 }),
    terminalProof: varchar('terminal_proof', {
      length: 40,
      enum: [
        'worker_completed',
        'worker_final_failure',
        'dispatch_exhausted',
        'legacy_retained_final_failure',
      ],
    }),
    terminalObservedAt: timestamp('terminal_observed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('ranking_run_round_unique').on(t.generationId, t.manualRound),
    uniqueIndex('ranking_run_generation_event_unique').on(t.generationId, t.eventId),
    check(
      'ranking_run_identity_shape',
      sql`${t.manualRound} BETWEEN 0 AND 3 AND ${t.automaticAttemptLimit} BETWEEN 1 AND 100 AND ((${t.manualRound}=0 AND ${t.origin} IN ('created','legacy_adopted')) OR (${t.manualRound}>0 AND ${t.origin}='manual_retry'))`,
    ),
    check(
      'ranking_run_result_shape',
      sql`(
      (${t.state}='pending' AND ${t.executionAttempts} IS NULL AND ${t.lastAttemptedAt} IS NULL AND ${t.lastErrorCode} IS NULL AND ${t.terminalProof} IS NULL AND ${t.terminalObservedAt} IS NULL) OR
      (${t.state}='retrying' AND ${t.executionAttempts}>=1 AND ${t.lastAttemptedAt} IS NOT NULL AND ${t.lastErrorCode} IS NOT NULL AND ${t.terminalProof} IS NULL AND ${t.terminalObservedAt} IS NULL) OR
      (${t.state}='completed' AND ${t.executionAttempts}>=1 AND ${t.lastAttemptedAt} IS NOT NULL AND ${t.lastErrorCode} IS NULL AND ${t.terminalProof}='worker_completed' AND ${t.terminalObservedAt} IS NOT NULL) OR
      (${t.state}='failed' AND ${t.lastErrorCode} IS NOT NULL AND ${t.terminalObservedAt} IS NOT NULL AND (
        (${t.terminalProof}='dispatch_exhausted' AND ${t.executionAttempts} IS NULL AND ${t.lastAttemptedAt} IS NULL) OR
        (${t.terminalProof} IN ('worker_final_failure','legacy_retained_final_failure') AND ${t.executionAttempts}>=${t.automaticAttemptLimit} AND ${t.lastAttemptedAt} IS NOT NULL)
      ))) IS TRUE`,
    ),
  ],
);

export const rankingBoards = pgTable(
  'ranking_boards',
  {
    generationId: uuid('generation_id')
      .notNull()
      .references(() => rankingGenerations.id, { onDelete: 'cascade' }),
    kind: varchar('kind', {
      length: 16,
      enum: ['hot', 'likes', 'favorites', 'downloads', 'new', 'updated'],
    }).notNull(),
    window: varchar('window', { length: 8, enum: ['7d', '30d', 'all', 'newcomer'] }).notNull(),
    platform: varchar('platform', { length: 16, enum: ['all', 'maibot', 'astrbot'] }).notNull(),
    entryCount: integer('entry_count').notNull(),
    capped: boolean('capped').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.generationId, t.kind, t.window, t.platform] }),
    check(
      'ranking_board_shape',
      sql`${t.entryCount} BETWEEN 0 AND 1000 AND ${t.platform} IN ('all','maibot','astrbot') AND (
    (${t.kind}='hot' AND ${t.window}='7d') OR (${t.kind} IN ('likes','favorites','downloads') AND ${t.window} IN ('7d','30d','all')) OR
    (${t.kind}='new' AND ${t.window} IN ('30d','newcomer')) OR (${t.kind}='updated' AND ${t.window}='all'))`,
    ),
  ],
);

// 快照仅保存有界排序事实与ID，公开正文和素材仍在读取时按实时资格重新投影
export const rankingEntries = pgTable(
  'ranking_entries',
  {
    generationId: uuid('generation_id').notNull(),
    kind: varchar('kind', { length: 16 }).notNull(),
    window: varchar('window', { length: 8 }).notNull(),
    platform: varchar('platform', { length: 16 }).notNull(),
    position: integer('position').notNull(),
    personaId: uuid('persona_id').notNull(),
    releaseId: uuid('release_id').notNull(),
    score: doublePrecision('score').notNull(),
    eligibleExports: bigint('eligible_exports', { mode: 'number' }).notNull(),
    eligibleLikes: bigint('eligible_likes', { mode: 'number' }).default(0).notNull(),
    eligibleFavorites: bigint('eligible_favorites', { mode: 'number' }).default(0).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.generationId, t.kind, t.window, t.platform, t.position] }),
    uniqueIndex('ranking_board_persona_unique').on(
      t.generationId,
      t.kind,
      t.window,
      t.platform,
      t.personaId,
    ),
    foreignKey({
      columns: [t.generationId, t.kind, t.window, t.platform],
      foreignColumns: [
        rankingBoards.generationId,
        rankingBoards.kind,
        rankingBoards.window,
        rankingBoards.platform,
      ],
      name: 'ranking_entry_board_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.personaId, t.releaseId],
      foreignColumns: [personaReleases.personaId, personaReleases.id],
      name: 'ranking_entry_release_owner_fk',
    }),
    check(
      'ranking_entry_bounds',
      sql`${t.position} BETWEEN 1 AND 1000 AND ${t.score} >= 0 AND ${t.score} < 9007199254740992 AND ${t.eligibleExports} BETWEEN 0 AND 9007199254740991 AND ${t.eligibleLikes} BETWEEN 0 AND 9007199254740991 AND ${t.eligibleFavorites} BETWEEN 0 AND 9007199254740991`,
    ),
  ],
);
