import { z } from 'zod';
import { ContentLimitsSchema, defaultContentLimits } from './persona.js';
import {
  SubmissionSettingsSchema,
  SubmissionPendingHintSchema,
  defaultSubmissionPendingHint,
} from './releases.js';
import { TimestampSchema, textSchema } from './common.js';
import { UsernameSchema } from './auth.js';
export const CreationSettingsSchema = z.strictObject({
  contentLimits: ContentLimitsSchema,
  submissions: SubmissionSettingsSchema,
});
export const defaultCreationSettings = {
  contentLimits: defaultContentLimits,
  submissions: {
    enabled: true,
    platforms: ['maibot', 'astrbot'],
    dailyQuota: 20,
    pendingHint: defaultSubmissionPendingHint,
  },
} as const;
const reason = textSchema(1, 2000).refine(
  (value) =>
    Array.from(value).every(
      (character) => !/\p{Cc}/u.test(character) || ['\t', '\r', '\n'].includes(character),
    ),
  '处理理由不能包含控制字符',
);
export const CreationSettingsWriteSchema = z.strictObject({ data: CreationSettingsSchema, reason });
export type CreationSettingsWrite = z.infer<typeof CreationSettingsWriteSchema>;
// 旧客户端不认识提示字段，省略时由事务保留当前值，不能在契约层注入默认值覆盖自定义说明。
export const CreationSettingsUpdateSchema = z.strictObject({
  data: CreationSettingsSchema.extend({
    submissions: SubmissionSettingsSchema.partial({ pendingHint: true }),
  }),
  reason: reason.default('更新创作与投稿设置'),
  expected: z.strictObject({
    contentLimits: z.number().int().positive(),
    submissions: z.number().int().positive(),
  }),
});
export type CreationSettingsUpdate = z.infer<typeof CreationSettingsUpdateSchema>;
export const CreationSettingsResponseSchema = z.strictObject({
  data: CreationSettingsSchema,
  defaults: CreationSettingsSchema,
  meta: z.strictObject({
    contentLimits: z.number().int().positive(),
    submissions: z.number().int().positive(),
  }),
});
export type CreationSettingsResponse = z.infer<typeof CreationSettingsResponseSchema>;
export const SubmissionSettingsRecordsQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(100).default(1),
});
export type SubmissionSettingsRecordsQuery = z.infer<typeof SubmissionSettingsRecordsQuerySchema>;
// 旧历史没有提示字段，明确表示当时未配置；不能用今天的默认值改写历史含义。
export const SubmissionSettingsRecordValueSchema = SubmissionSettingsSchema.extend({
  pendingHint: SubmissionPendingHintSchema.nullable(),
});
export const SubmissionSettingsRecordsResponseSchema = z.strictObject({
  data: z
    .array(
      z.strictObject({
        id: z.uuid(),
        actor: UsernameSchema,
        reason,
        before: SubmissionSettingsRecordValueSchema,
        after: SubmissionSettingsRecordValueSchema,
        fromRevision: z.number().int().positive(),
        toRevision: z.number().int().positive(),
        createdAt: TimestampSchema,
      }),
    )
    .max(20),
  meta: z.strictObject({
    page: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    pageSize: z.literal(20),
  }),
});
