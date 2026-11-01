import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  index,
  check,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './auth-schema.js';
import { personas } from './persona-schema.js';
export const assets = pgTable(
  'assets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    purpose: varchar('purpose', { length: 16, enum: ['content', 'evidence', 'avatar'] }).notNull(),
    storageKey: varchar('storage_key', { length: 64 }).notNull(),
    mime: varchar('mime', { length: 64 }).notNull(),
    bytes: integer('bytes').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    sourceUrl: text('source_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('asset_storage_key_unique').on(t.storageKey),
    index('assets_owner_idx').on(t.ownerId),
    check('asset_purpose_valid', sql`${t.purpose} IN ('content','evidence','avatar')`),
    check(
      'asset_size_valid',
      sql`${t.bytes} BETWEEN 1 AND 5242880 AND ${t.width}>0 AND ${t.height}>0 AND ${t.width}::bigint*${t.height}<=40000000`,
    ),
  ],
);
export const assetReferences = pgTable(
  'asset_references',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id),
    personaId: uuid('persona_id')
      .notNull()
      .references(() => personas.id),
    resourceType: varchar('resource_type', { length: 16, enum: ['draft', 'submission'] }).notNull(),
    resourceId: uuid('resource_id').notNull(),
    purpose: varchar('purpose', { length: 16, enum: ['content', 'evidence'] }).notNull(),
  },
  (t) => [
    uniqueIndex('asset_reference_unique').on(t.assetId, t.resourceType, t.resourceId, t.purpose),
    index('asset_reference_resource_idx').on(t.resourceId),
    check(
      'asset_reference_type',
      sql`${t.resourceType} IN ('draft','submission') AND ${t.purpose} IN ('content','evidence')`,
    ),
  ],
);
export const assetJobs = pgTable(
  'asset_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    sourceUrl: text('source_url').notNull(),
    status: varchar('status', { length: 16, enum: ['pending', 'processing', 'ready', 'failed'] })
      .default('pending')
      .notNull(),
    assetId: uuid('asset_id').references(() => assets.id),
    errorCode: varchar('error_code', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('asset_job_owner_idx').on(t.ownerId),
    check('asset_job_status_valid', sql`${t.status} IN ('pending','processing','ready','failed')`),
  ],
);
