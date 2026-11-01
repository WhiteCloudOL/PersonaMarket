import { z } from 'zod';

export const PlatformSchema = z.enum(['maibot', 'astrbot']);
export type Platform = z.infer<typeof PlatformSchema>;
export const IdSchema = z.uuid();
export const TimestampSchema = z.iso.datetime({ offset: true });

export const ErrorCodeSchema = z.enum([
  'INVALID_INPUT',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'MFA_REQUIRED',
  'REAUTH_REQUIRED',
  'NOT_FOUND',
  'CONFLICT',
  'REVISION_CONFLICT',
  'RATE_LIMITED',
  'MAINTENANCE_MODE',
  'SERVICE_UNAVAILABLE',
  'INVALID_RESPONSE',
  'INTERNAL_ERROR',
  'UNSUPPORTED_FORMAT',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export const ErrorResponseSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    fieldErrors: z.array(z.object({ path: z.string(), message: z.string() })),
    requestId: z.uuid(),
  }),
});

export const PaginationSchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** 按 Unicode code point 计数；只校验，不裁剪或改写作者正文。 */
export function textSchema(min: number, max: number) {
  return z
    .string()
    .refine((value) => Array.from(value).length >= min, '内容过短')
    .refine((value) => Array.from(value).length <= max, '内容过长')
    .refine((value) => min === 0 || value.trim().length > 0, '内容不能为空白');
}
