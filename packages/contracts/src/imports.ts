import { z } from 'zod';
import { IdSchema, TimestampSchema, textSchema } from './common.js';
import { DraftContentSchema } from './persona.js';
import {
  IMPORT_TEXT_MAX_BYTES,
  ImportTextEncodingSchema,
  ImportSourceEncodingSchema,
  TextImportFormatSchema,
} from './import-text.js';
export const NativeImportFormatSchema = z.enum(['maibot-toml', 'astrbot-json']);
export const ImportPreviewFormatSchema = z.enum([
  ...NativeImportFormatSchema.options,
  ...TextImportFormatSchema.options,
]);
export const NATIVE_IMPORT_MAX_BYTES = IMPORT_TEXT_MAX_BYTES;
export const NativeImportFileQuerySchema = z.strictObject({
  format: NativeImportFormatSchema,
  encoding: ImportTextEncodingSchema.default('auto'),
});
// 旧JSON入口保留2MiB预算；4MiB文件通过专用multipart入口，避免JSON转义扩大请求体
export const ImportPreviewRequestSchema = z.strictObject({
  format: NativeImportFormatSchema,
  filename: textSchema(1, 160).refine(
    (name) =>
      !/[\\/]/.test(name) &&
      Array.from(name).every((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code >= 32 && code !== 127;
      }),
    '请提供有效的文件名',
  ),
  source: z
    .string()
    .max(2 * 1024 * 1024)
    .refine(
      (text) => new TextEncoder().encode(text).byteLength <= 2 * 1024 * 1024,
      '原生文件不能超过 2 MiB',
    ),
});
export const ImportPreviewDataSchema = z.strictObject({
  id: IdSchema,
  format: ImportPreviewFormatSchema,
  filename: z.string(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: TimestampSchema,
  persona: DraftContentSchema,
  warnings: z.array(z.string()),
  ignoredFields: z.array(z.string()),
  sourceEncoding: ImportSourceEncodingSchema.optional(),
});
export const ImportPreviewResponseSchema = z.strictObject({ data: ImportPreviewDataSchema });
export const ImportConfirmRequestSchema = z.strictObject({
  previewId: IdSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  title: textSchema(2, 80),
  sourceDescription: textSchema(1, 2000),
  target: z.discriminatedUnion('mode', [
    z.strictObject({ mode: z.literal('new') }),
    z.strictObject({
      mode: z.literal('replace'),
      personaId: IdSchema,
      expectedRevision: z.number().int().positive(),
    }),
  ]),
  confirmed: z.literal(true, { error: '请确认导入范围与来源后继续' }),
});
