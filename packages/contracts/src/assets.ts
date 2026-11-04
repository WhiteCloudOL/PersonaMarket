import { z } from 'zod';
import { IdSchema, TimestampSchema } from './common.js';
export const AssetPurposeSchema = z.enum(['content', 'evidence', 'avatar']);
export const PERSONA_AVATAR_MAX_BYTES = 10 * 1024 * 1024;
export const AssetUploadParamsSchema = z.strictObject({ purpose: AssetPurposeSchema });
export const AssetInfoSchema = z.strictObject({
  id: IdSchema,
  purpose: AssetPurposeSchema,
  mime: z.literal('image/webp'),
  bytes: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  createdAt: TimestampSchema,
});
export const AssetResponseSchema = z.strictObject({ data: AssetInfoSchema });
export const AssetListResponseSchema = z.strictObject({ data: z.array(AssetInfoSchema) });
export const ImportImageSchema = z.strictObject({ url: z.url({ protocol: /^https$/ }).max(2048) });
export const AssetJobResponseSchema = z.strictObject({
  data: z.strictObject({
    id: IdSchema,
    status: z.enum(['pending', 'processing', 'ready', 'failed']),
    assetId: IdSchema.nullable(),
    message: z.string().nullable(),
  }),
});
export const AssetImportJobSchema = z.strictObject({
  eventId: IdSchema,
  schemaVersion: z.literal(1),
  jobId: IdSchema,
});
