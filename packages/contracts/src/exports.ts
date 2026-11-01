import { z } from 'zod';
export const ExportFormatSchema = z.enum([
  'text',
  'markdown',
  'maibot-toml',
  'astrbot-json',
  'market-json',
  'market-zip',
]);
export const ExportQuerySchema = z.strictObject({ format: ExportFormatSchema });
export const ExportPreviewResponseSchema = z.strictObject({
  data: z.strictObject({
    format: ExportFormatSchema,
    filename: z.string(),
    mime: z.string(),
    warnings: z.array(z.string()),
    omittedFields: z.array(z.string()),
    text: z.string(),
  }),
});
export type ExportFormat = z.infer<typeof ExportFormatSchema>;
