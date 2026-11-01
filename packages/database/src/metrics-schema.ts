import { sql } from 'drizzle-orm';
import {
  check,
  boolean,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { personas } from './persona-schema.js';
import { personaReleases } from './release-schema.js';

// 短期去重凭据与长期日汇总分开；汇总是同一写事务提交的计数事实
export const exportSubjectDays = pgTable(
  'export_subject_days',
  {
    personaId: uuid('persona_id')
      .notNull()
      .references(() => personas.id),
    day: date('day', { mode: 'string' }).notNull(),
    subjectHash: varchar('subject_hash', { length: 64 }).notNull(),
    rankingEligible: boolean('ranking_eligible').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.personaId, t.day, t.subjectHash] }),
    index('export_subject_expiry_idx').on(t.day),
    check('export_subject_hash_valid', sql`${t.subjectHash} ~ '^[a-f0-9]{64}$'`),
  ],
);
export const exportVersionSubjectDays = pgTable(
  'export_version_subject_days',
  {
    personaId: uuid('persona_id').notNull(),
    releaseId: uuid('release_id').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    format: varchar('format', { length: 32 }).notNull(),
    subjectHash: varchar('subject_hash', { length: 64 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.releaseId, t.day, t.format, t.subjectHash] }),
    foreignKey({
      columns: [t.personaId, t.releaseId],
      foreignColumns: [personaReleases.personaId, personaReleases.id],
      name: 'export_version_subject_owner_fk',
    }),
    index('export_version_subject_expiry_idx').on(t.day),
    check('export_version_subject_hash_valid', sql`${t.subjectHash} ~ '^[a-f0-9]{64}$'`),
    check(
      'export_version_subject_format_valid',
      sql`${t.format} IN ('text','markdown','maibot-toml','astrbot-json','market-json','market-zip')`,
    ),
  ],
);
export const exportDailyMetrics = pgTable(
  'export_daily_metrics',
  {
    personaId: uuid('persona_id')
      .notNull()
      .references(() => personas.id),
    day: date('day', { mode: 'string' }).notNull(),
    totalCount: integer('total_count').default(0).notNull(),
    rankingCount: integer('ranking_count').default(0).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.personaId, t.day] }),
    index('export_daily_window_idx').on(t.day, t.personaId),
    check(
      'export_daily_counts_valid',
      sql`${t.totalCount} >= 0 AND ${t.rankingCount} BETWEEN 0 AND ${t.totalCount}`,
    ),
  ],
);
export const exportVersionDailyMetrics = pgTable(
  'export_version_daily_metrics',
  {
    personaId: uuid('persona_id').notNull(),
    releaseId: uuid('release_id').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    format: varchar('format', { length: 32 }).notNull(),
    totalCount: integer('total_count').default(0).notNull(),
    rankingCount: integer('ranking_count').default(0).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.releaseId, t.day, t.format] }),
    foreignKey({
      columns: [t.personaId, t.releaseId],
      foreignColumns: [personaReleases.personaId, personaReleases.id],
      name: 'export_version_daily_owner_fk',
    }),
    check(
      'export_version_daily_counts_valid',
      sql`${t.totalCount} >= 0 AND ${t.rankingCount} BETWEEN 0 AND ${t.totalCount}`,
    ),
    check(
      'export_version_daily_format_valid',
      sql`${t.format} IN ('text','markdown','maibot-toml','astrbot-json','market-json','market-zip')`,
    ),
  ],
);
