import { z } from 'zod';
import { ExportFormatSchema } from './exports.js';
import { ImportPreviewFormatSchema } from './imports.js';
import { MarketImportFormatSchema } from './market-imports.js';
import {
  HomeSettingsWriteSchema,
  HomeSettingsResponseSchema,
  HomeSettingsRecordsResponseSchema,
  HomeSettingsRecordsQuerySchema,
} from './home-settings.js';
import { IMPORT_TEXT_MAX_BYTES } from './import-text.js';
import { MARKET_ARCHIVE_MAX_BYTES } from './market-persona.js';

export const TransferImportFormatSchema = z.enum([
  ...ImportPreviewFormatSchema.options,
  ...MarketImportFormatSchema.options,
]);
const unique = <T>(items: T[]) => new Set(items).size === items.length;
export const TransferSettingsSchema = z.strictObject({
  guestExportsEnabled: z.boolean(),
  importFormats: z.array(TransferImportFormatSchema).max(6).refine(unique, '导入格式不能重复'),
  exportFormats: z.array(ExportFormatSchema).max(6).refine(unique, '导出格式不能重复'),
  maxImportFileKiB: z
    .number()
    .int()
    .min(64)
    .max(IMPORT_TEXT_MAX_BYTES / 1024),
  maxImportArchiveMiB: z
    .number()
    .int()
    .min(1)
    .max(MARKET_ARCHIVE_MAX_BYTES / 1024 / 1024),
});
export type TransferSettings = z.infer<typeof TransferSettingsSchema>;
export type TransferImportFormat = z.infer<typeof TransferImportFormatSchema>;
export const defaultTransferSettings: TransferSettings = {
  guestExportsEnabled: true,
  importFormats: [...TransferImportFormatSchema.options],
  exportFormats: [...ExportFormatSchema.options],
  maxImportFileKiB: IMPORT_TEXT_MAX_BYTES / 1024,
  maxImportArchiveMiB: MARKET_ARCHIVE_MAX_BYTES / 1024 / 1024,
};
export const TransferSettingsWriteSchema = HomeSettingsWriteSchema.extend({
  data: TransferSettingsSchema,
});
export type TransferSettingsWrite = z.infer<typeof TransferSettingsWriteSchema>;
export const TransferSettingsResponseSchema = HomeSettingsResponseSchema.extend({
  data: TransferSettingsSchema,
  defaults: TransferSettingsSchema,
});
export type TransferSettingsResponse = z.infer<typeof TransferSettingsResponseSchema>;
export const PublicTransferSettingsResponseSchema = z.strictObject({
  data: TransferSettingsSchema,
  meta: z.strictObject({ revision: z.number().int().positive() }),
});
export const TransferSettingsRecordsQuerySchema = HomeSettingsRecordsQuerySchema;
export type TransferSettingsRecordsQuery = z.infer<typeof TransferSettingsRecordsQuerySchema>;
export const TransferSettingsRecordsResponseSchema = TransferSettingsRecordsResponse();
function TransferSettingsRecordsResponse() {
  const row = HomeSettingsRecordsResponseSchema.shape.data.element.extend({
    before: TransferSettingsSchema,
    after: TransferSettingsSchema,
  });
  return HomeSettingsRecordsResponseSchema.extend({ data: z.array(row).max(20) });
}
export const transferSettingsEtag = (revision: number) => '"transfer-' + revision + '"';
