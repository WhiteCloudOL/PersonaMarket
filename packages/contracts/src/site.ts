import { z } from 'zod';
import { textSchema } from './common.js';

export const PublicBrandSchema = z.object({
  name: textSchema(2, 80),
  description: textSchema(1, 200),
  defaultLocale: z.literal('zh-CN'),
});
export type PublicBrand = z.infer<typeof PublicBrandSchema>;
export const PublicConfigResponseSchema = z.object({
  data: PublicBrandSchema,
  meta: z.object({ revision: z.number().int().positive() }),
});
export type PublicConfigResponse = z.infer<typeof PublicConfigResponseSchema>;
export const HealthResponseSchema = z.object({ data: z.object({ status: z.literal('ok') }) });
export const SystemJobSchema = z.strictObject({ eventId: z.uuid(), schemaVersion: z.literal(1) });
export const MailJobSchema = z.strictObject({
  eventId: z.uuid(),
  schemaVersion: z.literal(1),
  encryptedMessage: z.string().min(1).max(65536),
});
