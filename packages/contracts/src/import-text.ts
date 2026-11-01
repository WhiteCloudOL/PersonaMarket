import { z } from 'zod';

export const IMPORT_TEXT_MAX_BYTES = 4 * 1024 * 1024;
export const TextImportFormatSchema = z.enum(['text-plain', 'text-markdown']);
export const ImportTextEncodingSchema = z.enum([
  'auto',
  'utf-8',
  'gbk',
  'gb18030',
  'utf-16le',
  'utf-16be',
]);
export const ImportSourceEncodingSchema = z.strictObject({
  encoding: ImportTextEncodingSchema.exclude(['auto']),
  determinedBy: z.enum(['bom', 'utf8', 'fallback', 'manual']),
});
export type ImportTextEncoding = z.infer<typeof ImportTextEncodingSchema>;
export type ImportSourceEncoding = z.infer<typeof ImportSourceEncodingSchema>;
