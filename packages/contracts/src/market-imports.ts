import { z } from 'zod';
import { IdSchema, TimestampSchema, textSchema } from './common.js';
import { PersonaDraftSchema } from './creation.js';
import { ImportConfirmRequestSchema } from './imports.js';
import { MarketMetadataSchema, MarketPersonaSchema } from './market-persona.js';
import { ImportTextEncodingSchema, ImportSourceEncodingSchema } from './import-text.js';

export const MarketImportFormatSchema = z.enum(['market-json', 'market-zip']);
export const MarketImportFileQuerySchema = z.strictObject({
  encoding: ImportTextEncodingSchema.default('auto'),
});
export const MarketImportIdSchema = z.strictObject({ id: IdSchema });
export const MarketImportImageParamsSchema = z.strictObject({ id: IdSchema, assetId: IdSchema });
export const MarketImportImageSchema = z.strictObject({
  id: IdSchema,
  key: IdSchema,
  status: z.enum(['pending', 'queued', 'processing', 'ready', 'failed']),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  bytes: z.number().int().positive().max(5242880),
  sourceUrl: z.string().max(2048).optional(),
});
export const MarketImportPreviewSchema = z.strictObject({
  id: IdSchema,
  format: MarketImportFormatSchema,
  filename: textSchema(1, 160),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: TimestampSchema,
  draft: PersonaDraftSchema,
  declaredOrigin: MarketMetadataSchema.shape.origin,
  source: MarketPersonaSchema.options[0].shape.source,
  categoryName: textSchema(1, 80).optional(),
  tagNames: z.array(textSchema(1, 80)).max(8),
  images: z.array(MarketImportImageSchema).max(22),
  warnings: z.array(z.string()).max(32),
  sourceEncoding: ImportSourceEncodingSchema.optional(),
});
export const MarketImportPreviewResponseSchema = z.strictObject({
  data: MarketImportPreviewSchema,
});
export const MarketImportImageListResponseSchema = z.strictObject({
  data: z.array(MarketImportImageSchema).max(22),
});
export const MarketImportDiscardResponseSchema = z.strictObject({
  data: z.strictObject({ id: IdSchema, cancelled: z.literal(true) }),
});
export const MarketImportConfirmSchema = ImportConfirmRequestSchema.extend({
  authorizationStatement: textSchema(0, 5000).optional(),
});
export const MarketImportImageJobSchema = z.strictObject({
  schemaVersion: z.literal(1),
  eventId: IdSchema,
  assetId: IdSchema,
});
export const StorageCleanupJobSchema = z.strictObject({
  schemaVersion: z.literal(1),
  eventId: IdSchema,
  storageKey: z.string().regex(/^[a-f0-9]{32}\.webp$/),
});
export type MarketImportPreview = z.infer<typeof MarketImportPreviewSchema>;
