import { z } from 'zod';
import { IdSchema, TimestampSchema, textSchema } from './common.js';
import { UsernameSchema } from './auth.js';
import { HomeSettingsWriteSchema, HomeSettingsRecordsQuerySchema } from './home-settings.js';

export const ModelSuggestionSchema = z.strictObject({
  id: IdSchema,
  modelId: textSchema(1, 200).refine(
    (value) => value === value.trim() && !/\p{Cc}/u.test(value),
    '模型标识不能包含控制字符或首尾空格',
  ),
  note: textSchema(0, 500).refine((value) => !/\p{Cc}/u.test(value), '备注请使用单行文字'),
  enabled: z.boolean(),
});
export const ModelSuggestionsSchema = z.strictObject({
  entries: z
    .array(ModelSuggestionSchema)
    .max(100, '最多维护 100 条模型建议')
    .superRefine((rows, ctx) => {
      const ids = new Set<string>(),
        names = new Set<string>();
      for (const [index, row] of rows.entries()) {
        if (ids.has(row.id.toLowerCase()))
          ctx.addIssue({ code: 'custom', path: [index, 'id'], message: '建议标识不能重复' });
        if (names.has(row.modelId.toLowerCase()))
          ctx.addIssue({
            code: 'custom',
            path: [index, 'modelId'],
            message: '模型标识不能重复，大小写视为相同',
          });
        ids.add(row.id.toLowerCase());
        names.add(row.modelId.toLowerCase());
      }
    }),
});
export type ModelSuggestions = z.infer<typeof ModelSuggestionsSchema>;
export const defaultModelSuggestions: ModelSuggestions = { entries: [] };
export const ModelSuggestionsWriteSchema = z.strictObject({
  data: ModelSuggestionsSchema,
  reason: HomeSettingsWriteSchema.shape.reason,
});
export type ModelSuggestionsWrite = z.infer<typeof ModelSuggestionsWriteSchema>;
export function modelSuggestionsEtag(revision: number) {
  return '"models-' + revision + '"';
}
const revision = z.number().int().positive();
export const PublicModelSuggestionsResponseSchema = z.strictObject({
  data: z.array(ModelSuggestionSchema.omit({ enabled: true })).max(100),
  meta: z.strictObject({ revision }),
});
export const ModelSuggestionsResponseSchema = z.strictObject({
  data: ModelSuggestionsSchema,
  defaults: ModelSuggestionsSchema,
  meta: z.strictObject({
    revision,
    updatedAt: TimestampSchema,
    updatedBy: UsernameSchema.nullable(),
  }),
});
export type ModelSuggestionsResponse = z.infer<typeof ModelSuggestionsResponseSchema>;
export const ModelSuggestionsRecordsQuerySchema = HomeSettingsRecordsQuerySchema;
export type ModelSuggestionsRecordsQuery = z.infer<typeof ModelSuggestionsRecordsQuerySchema>;
export const ModelSuggestionsRecordsResponseSchema = z.strictObject({
  data: z
    .array(
      z.strictObject({
        id: IdSchema,
        actor: UsernameSchema,
        reason: textSchema(1, 2000),
        before: ModelSuggestionsSchema,
        after: ModelSuggestionsSchema,
        fromRevision: revision,
        toRevision: revision,
        createdAt: TimestampSchema,
      }),
    )
    .max(20),
  meta: z.strictObject({
    page: revision,
    pageSize: z.literal(20),
    total: z.number().int().nonnegative(),
  }),
});
