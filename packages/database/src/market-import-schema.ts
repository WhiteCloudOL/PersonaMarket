import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  check,
  index,
  integer,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './auth-schema.js';
import { personas } from './persona-schema.js';

export const marketImports = pgTable(
  'market_imports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    format: varchar('format', { length: 32, enum: ['market-json', 'market-zip'] }).notNull(),
    state: varchar('state', { length: 16, enum: ['processing', 'ready', 'failed'] }).notNull(),
    filename: varchar('filename', { length: 160 }).notNull(),
    inputBytes: integer('input_bytes'),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    document: jsonb('document').$type<unknown>().notNull(),
    confirmationHash: varchar('confirmation_hash', { length: 64 }),
    resultPersonaId: uuid('result_persona_id').references(() => personas.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check(
      'market_import_input_bytes_bounded',
      sql`${t.inputBytes} IS NULL OR ${t.inputBytes} BETWEEN 0 AND 134217728`,
    ),
    check('market_import_format_valid', sql`${t.format} IN ('market-json','market-zip')`),
    check('market_import_state_valid', sql`${t.state} IN ('processing','ready','failed')`),
    // 4MiB源清单加最多64KiB的jsonb空白表示开销；不放宽旧原生预览与全站请求
    check('market_import_document_bounded', sql`octet_length(${t.document}::text)<=4259840`),
    check(
      'market_import_result_consistent',
      sql`(${t.consumedAt} IS NULL AND ${t.resultPersonaId} IS NULL AND ${t.confirmationHash} IS NULL) OR (${t.consumedAt} IS NOT NULL AND ${t.resultPersonaId} IS NOT NULL AND ${t.confirmationHash} IS NOT NULL AND ${t.state}='ready')`,
    ),
    index('market_import_owner_expiry_idx').on(t.ownerId, t.expiresAt),
    index('market_import_expiry_idx').on(t.expiresAt, t.id),
  ],
);

export const marketImportAssets = pgTable(
  'market_import_assets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    previewId: uuid('preview_id')
      .notNull()
      .references(() => marketImports.id, { onDelete: 'cascade' }),
    packageKey: uuid('package_key').notNull(),
    storageKey: varchar('storage_key', { length: 64 }).notNull(),
    sourceUrl: text('source_url'),
    expectedMime: varchar('expected_mime', { length: 64 }).notNull(),
    expectedBytes: integer('expected_bytes').notNull(),
    expectedHash: varchar('expected_hash', { length: 64 }).notNull(),
    status: varchar('status', {
      length: 16,
      enum: ['pending', 'queued', 'processing', 'ready', 'failed'],
    })
      .default('pending')
      .notNull(),
    bytes: integer('bytes'),
    width: integer('width'),
    height: integer('height'),
    sha256: varchar('sha256', { length: 64 }),
  },
  (t) => [
    uniqueIndex('market_import_asset_key_unique').on(t.previewId, t.packageKey),
    uniqueIndex('market_import_storage_key_unique').on(t.storageKey),
    check(
      'market_import_asset_status_valid',
      sql`${t.status} IN ('pending','queued','processing','ready','failed')`,
    ),
    check(
      'market_import_asset_expected_valid',
      sql`${t.expectedBytes} BETWEEN 1 AND 5242880 AND ${t.expectedMime} IN ('image/png','image/jpeg','image/webp') AND ${t.expectedHash} ~ '^[a-f0-9]{64}$' AND ${t.storageKey} ~ '^[a-f0-9]{32}[.]webp$'`,
    ),
    check(
      'market_import_asset_ready_valid',
      sql`${t.status}<>'ready' OR (${t.bytes} IS NOT NULL AND ${t.width} IS NOT NULL AND ${t.height} IS NOT NULL AND ${t.sha256} IS NOT NULL AND ${t.bytes} BETWEEN 1 AND 5242880 AND ${t.width}>0 AND ${t.height}>0 AND ${t.width}::bigint*${t.height}<=40000000 AND ${t.sha256} ~ '^[a-f0-9]{64}$')`,
    ),
  ],
);
