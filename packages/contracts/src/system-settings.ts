import { z } from 'zod';
import { IdSchema, TimestampSchema, textSchema } from './common.js';

const controlledText = (min: number, max: number) =>
  textSchema(min, max).refine(
    (value) =>
      Array.from(value).every(
        (character) => !/\p{Cc}/u.test(character) || ['\t', '\r', '\n'].includes(character),
      ),
    '请移除不可显示的控制字符',
  );
export const MaintenanceMessageSchema = controlledText(0, 500).refine(
  (value) => value === '' || value.trim().length > 0,
  '提示不能仅包含空白',
);
export const SystemSettingsSchema = z.strictObject({
  maintenanceEnabled: z.boolean(),
  maintenanceMessage: MaintenanceMessageSchema,
});
export type SystemSettings = z.infer<typeof SystemSettingsSchema>;
export const defaultSystemSettings: SystemSettings = {
  maintenanceEnabled: false,
  maintenanceMessage: '',
};
export const SystemSettingsWriteSchema = z.strictObject({
  data: SystemSettingsSchema,
  reason: controlledText(1, 2000).default('更新维护设置'),
  confirmed: z.literal(true),
});
export type SystemSettingsWrite = z.infer<typeof SystemSettingsWriteSchema>;
const meta = z.strictObject({ revision: z.number().int().positive() });
export const SystemSettingsResponseSchema = z.strictObject({
  data: SystemSettingsSchema,
  defaults: SystemSettingsSchema,
  meta,
});
export type SystemSettingsResponse = z.infer<typeof SystemSettingsResponseSchema>;
export const PublicSystemStatusResponseSchema = z.strictObject({
  data: SystemSettingsSchema,
  meta,
});
export type PublicSystemStatusResponse = z.infer<typeof PublicSystemStatusResponseSchema>;
export const SystemSettingsRecordsQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(100).default(1),
});
export type SystemSettingsRecordsQuery = z.infer<typeof SystemSettingsRecordsQuerySchema>;
export const SystemSettingsRecordsResponseSchema = z.strictObject({
  data: z
    .array(
      z.strictObject({
        id: IdSchema,
        actor: z.string().min(3).max(32),
        reason: controlledText(1, 2000),
        before: SystemSettingsSchema,
        after: SystemSettingsSchema,
        fromRevision: z.number().int().positive(),
        toRevision: z.number().int().positive(),
        createdAt: TimestampSchema,
      }),
    )
    .max(20),
  meta: z.strictObject({
    page: z.number().int().positive(),
    pageSize: z.literal(20),
    total: z.number().int().nonnegative(),
  }),
});
export type SystemSettingsRecordsResponse = z.infer<typeof SystemSettingsRecordsResponseSchema>;
export const SystemRuntimeResponseSchema = z.strictObject({
  data: z.strictObject({
    component: z.literal('api'),
    build: z.strictObject({
      version: z.string().min(1).max(100).nullable(),
      sourceRevision: z
        .string()
        .regex(/^[a-f0-9]{40}$/u)
        .nullable(),
      sourceDirty: z.boolean().nullable(),
      builtAt: TimestampSchema.nullable(),
      status: z.enum(['available', 'unavailable']),
    }),
    nodeVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
  }),
});
export type SystemRuntimeResponse = z.infer<typeof SystemRuntimeResponseSchema>;
export function systemSettingsEtag(revision: number) {
  return '"system-' + revision + '"';
}
