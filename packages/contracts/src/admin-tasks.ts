import { z } from 'zod';
import { IdSchema, TimestampSchema } from './common.js';

export const ADMIN_TASK_MAX_PAGE = 500;
export const ADMIN_TASK_QUEUE_SAMPLE_LIMIT = 500;
export const AdminTaskQueueObservationSchema = z.strictObject({
  status: z.enum(['ready', 'partial', 'unavailable']),
  checkedAt: TimestampSchema,
  retainedFailed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  inspected: z.number().int().min(0).max(ADMIN_TASK_QUEUE_SAMPLE_LIMIT),
  unverifiable: z.number().int().min(0).max(ADMIN_TASK_QUEUE_SAMPLE_LIMIT),
  limit: z.literal(ADMIN_TASK_QUEUE_SAMPLE_LIMIT),
});
export type AdminTaskQueueObservation = z.infer<typeof AdminTaskQueueObservationSchema>;

export const TaskCategorySchema = z.enum([
  'mail',
  'images',
  'rankings',
  'notifications',
  'storage',
  'system',
  'unknown',
]);
export const TaskFailureStageSchema = z.enum(['dispatch', 'execution', 'uncertain']);
export const AdminTaskQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(ADMIN_TASK_MAX_PAGE).default(1),
  category: z.enum(['all', ...TaskCategorySchema.options]).default('all'),
  stage: z.enum(['all', ...TaskFailureStageSchema.options]).default('all'),
});
export type AdminTaskQuery = z.infer<typeof AdminTaskQuerySchema>;

export const AdminTaskFailureSchema = z.strictObject({
  source: z.enum(['dispatch', 'image', 'market_image', 'ranking', 'notification', 'mail', 'queue']),
  id: IdSchema,
  category: TaskCategorySchema,
  stage: TaskFailureStageSchema,
  errorCode: z.enum([
    'DISPATCH_FAILED',
    'IMAGE_IMPORT_FAILED',
    'RANKING_BUILD_FAILED',
    'NOTIFICATION_DELIVERY_FAILED',
    'MAIL_SEND_FAILED',
    'MAIL_NOT_CONFIGURED',
    'MAIL_PAYLOAD_INVALID',
    'MAIL_RESULT_UNCERTAIN',
    'MAIL_RECEIPT_UNCERTAIN',
    'QUEUE_EXECUTION_FAILED',
  ]),
  // 旧图片任务没有持久化执行次数，不能用分发尝试数或固定5冒充
  executionAttempts: z.number().int().nonnegative().nullable(),
  dispatchAttempts: z.number().int().nonnegative().nullable(),
  createdAt: TimestampSchema,
  eventId: IdSchema.nullable(),
  version: z.string().regex(/^[a-f0-9]{64}$/u),
});
export type AdminTaskFailure = z.infer<typeof AdminTaskFailureSchema>;
export const ADMIN_TASK_RETRY_LIMIT = 3;
export const ADMIN_TASK_RETRY_COOLDOWN_SECONDS = 60;
export const AdminTaskPathSchema = z.strictObject({
  source: AdminTaskFailureSchema.shape.source,
  id: IdSchema,
});
export type AdminTaskPath = z.infer<typeof AdminTaskPathSchema>;
export const AdminTaskReasonSchema = z
  .string()
  .trim()
  .min(5, '请填写至少5个字符的处理原因')
  .max(500, '处理原因最多500个字符')
  .refine((value) => Array.from(value).length >= 5, '请填写至少5个字符的处理原因');
export const RetryAdminTaskSchema = z.strictObject({
  expectedVersion: AdminTaskFailureSchema.shape.version,
  reason: AdminTaskReasonSchema,
  confirmed: z.literal(true),
});
export type RetryAdminTask = z.infer<typeof RetryAdminTaskSchema>;
export const AdminTaskRetrySchema = z.strictObject({
  id: IdSchema,
  source: AdminTaskFailureSchema.shape.source,
  taskId: IdSchema,
  eventId: IdSchema,
  previousEventId: IdSchema.nullable(),
  actorId: IdSchema,
  attempt: z.number().int().min(1).max(ADMIN_TASK_RETRY_LIMIT),
  reason: z.string().min(5).max(500),
  createdAt: TimestampSchema,
});
export const AdminTaskRetryResponseSchema = z.strictObject({ data: AdminTaskRetrySchema });
export const AdminTaskRetryHistoryResponseSchema = z.strictObject({
  data: z.array(AdminTaskRetrySchema).max(ADMIN_TASK_RETRY_LIMIT),
  meta: z.strictObject({
    maxAttempts: z.literal(ADMIN_TASK_RETRY_LIMIT),
    cooldownSeconds: z.literal(ADMIN_TASK_RETRY_COOLDOWN_SECONDS),
  }),
});
export const AdminTaskListResponseSchema = z.strictObject({
  data: z.array(AdminTaskFailureSchema).max(20),
  meta: z.strictObject({
    page: z.number().int().min(1).max(ADMIN_TASK_MAX_PAGE),
    pageSize: z.literal(20),
    total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    observedAt: TimestampSchema,
    queueObservation: AdminTaskQueueObservationSchema,
  }),
});
export const AdminTaskDetailResponseSchema = z.strictObject({
  data: AdminTaskFailureSchema.nullable(),
  meta: z.strictObject({
    observedAt: TimestampSchema,
    queueObservation: AdminTaskQueueObservationSchema,
  }),
});
