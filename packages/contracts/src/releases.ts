import { z } from 'zod';
import { PersonaCurationSchema } from './curation.js';
import { InteractionCountsSchema } from './interactions.js';
import { RankingHeatMetricSchema, RankingInteractionMetricSchema } from './ranking-algorithm.js';
import {
  IdSchema,
  TimestampSchema,
  textSchema,
  PlatformSchema,
  PaginationSchema,
} from './common.js';
import { PublicSnapshotSchema, PublicCardSnapshotSchema, RedistributionSchema } from './persona.js';
export const PUBLIC_SEARCH_RESULT_LIMIT = 1000;
const PublicQueryFiltersSchema = PaginationSchema.extend({
  q: textSchema(0, 80)
    .refine((value) => !/\p{Cc}/u.test(value), '搜索关键词不能包含控制字符')
    .default(''),
  platform: PlatformSchema.optional(),
  categoryId: IdSchema.optional(),
  tagId: IdSchema.optional(),
  tagIds: textSchema(1, 295)
    .refine((value) => {
      const items = value.split(',').map((id) => id.trim());
      return items.length <= 8 && items.every((id) => IdSchema.safeParse(id).success);
    }, '请选择最多8个标签，多标签需同时匹配')
    .optional()
    .describe('逗号分隔的标签ID，最多8项，AND匹配'),
  model: textSchema(1, 200).optional(),
  origin: z.enum(['original', 'repost']).optional(),
  redistribution: RedistributionSchema.optional(),
  publishedWithin: z.enum(['all', '7d', '30d']).default('all'),
  hasDialogue: z.enum(['true', 'false']).optional(),
  featured: z.enum(['true', 'false']).optional(),
  sort: z
    .enum([
      'relevance',
      'newest',
      'updated',
      'oldest',
      'title',
      'downloads',
      'recent-downloads',
      'hot',
      'likes',
      'favorites',
    ])
    .default('relevance'),
});
export function publicPersonaTagIds(
  query: Pick<z.infer<typeof PublicQueryFiltersSchema>, 'tagId' | 'tagIds'>,
) {
  return [
    ...new Set(
      [...(query.tagIds?.split(',') ?? []), ...(query.tagId ? [query.tagId] : [])].map((id) =>
        id.trim().toLowerCase(),
      ),
    ),
  ];
}
export const PublicPersonaQuerySchema = PublicQueryFiltersSchema.superRefine((value, context) => {
  if (publicPersonaTagIds(value).length > 8)
    context.addIssue({ code: 'custom', path: ['tagIds'], message: '最多同时选择8个标签' });
  if (
    value.q.trim() &&
    (value.page > 100 || (value.page - 1) * value.pageSize >= PUBLIC_SEARCH_RESULT_LIMIT)
  )
    context.addIssue({
      code: 'custom',
      path: ['page'],
      message: '搜索最多查看前1000个结果，请缩小关键词或筛选范围',
    });
});
export type PublicPersonaQuery = z.infer<typeof PublicPersonaQuerySchema>;
export const ReleaseVersionSchema = z
  .string()
  .trim()
  .regex(
    /^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/,
    '请输入稳定版本号，例如 1.0.0',
  );
export const CreateReleaseSchema = z.strictObject({
  version: ReleaseVersionSchema,
  changelog: textSchema(0, 5000).default(''),
  expectedDraftRevision: z.number().int().positive(),
  confirmed: z.literal(true, { error: '请确认公开信息与来源许可后再提交' }),
});
export const PublicationSchema = z.strictObject({
  publisher: z.string(),
  category: z.strictObject({ id: IdSchema, name: z.string() }),
  tags: z.array(z.strictObject({ id: IdSchema, name: z.string() })),
});
export const SubmissionSchema = z.strictObject({
  id: IdSchema,
  personaId: IdSchema,
  releaseId: IdSchema,
  version: ReleaseVersionSchema,
  releaseLifecycle: z.enum(['UNPUBLISHED', 'PUBLISHED', 'WITHDRAWN', 'BLOCKED']),
  current: z.boolean(),
  publishedAt: TimestampSchema.nullable(),
  attemptNumber: z.number().int().positive(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN']),
  revision: z.number().int().positive(),
  snapshot: PublicSnapshotSchema,
  publication: PublicationSchema,
  changelog: z.string(),
  contentHash: z.string(),
  createdAt: TimestampSchema,
  reason: z.string().nullable(),
});
export const SubmissionResponseSchema = z.strictObject({ data: SubmissionSchema });
export const SubmissionListResponseSchema = z.strictObject({ data: z.array(SubmissionSchema) });
export const SubmissionIdSchema = z.strictObject({ id: IdSchema });
export const ReviewRequestSchema = z.strictObject({
  action: z.enum(['approve', 'reject']),
  expectedRevision: z.number().int().positive(),
  reason: textSchema(0, 5000),
  selfReviewConfirmed: z.boolean(),
});
export const WithdrawSubmissionSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  reason: textSchema(1, 5000),
});
export const ModerationRecordSchema = z.strictObject({
  id: IdSchema,
  action: z.string(),
  reason: z.string(),
  selfReview: z.boolean(),
  createdAt: TimestampSchema,
  actor: z.string(),
});
export const ReviewDetailResponseSchema = z.strictObject({
  data: z.strictObject({
    submission: SubmissionSchema,
    previous: PublicSnapshotSchema.nullable(),
    records: z.array(ModerationRecordSchema),
    evidenceAssetIds: z.array(IdSchema),
  }),
});
export const PublicReleaseSchema = z.strictObject({
  curation: PersonaCurationSchema.optional(),
  interactionCounts: InteractionCountsSchema,
  personaId: IdSchema,
  releaseId: IdSchema,
  version: ReleaseVersionSchema,
  snapshot: PublicSnapshotSchema,
  publication: PublicationSchema,
  changelog: z.string(),
  publishedAt: TimestampSchema,
  current: z.boolean(),
});
export const PublicReleaseResponseSchema = z.strictObject({ data: PublicReleaseSchema });
export const PublicReleaseListResponseSchema = z.strictObject({
  data: z.array(PublicReleaseSchema),
});
export const PublicPersonaCardSchema = PublicReleaseSchema.omit({
  snapshot: true,
  changelog: true,
}).extend({
  snapshot: PublicCardSnapshotSchema,
  firstPublishedAt: TimestampSchema,
  exportMetric: z
    .strictObject({
      eligibleExports: z.number().int().nonnegative(),
      window: z.enum(['7d', 'all']),
    })
    .optional(),
  heatMetric: RankingHeatMetricSchema.optional(),
  interactionMetric: RankingInteractionMetricSchema.optional(),
});
export type PublicPersonaCard = z.infer<typeof PublicPersonaCardSchema>;
export const PublicPersonaListResponseSchema = z.strictObject({
  data: z.array(PublicPersonaCardSchema),
  meta: z.strictObject({
    page: z.number(),
    pageSize: z.number(),
    total: z.number(),
    capped: z.boolean().default(false),
  }),
});
export const VisibilityRequestSchema = z.strictObject({
  visibility: z.enum(['listed', 'hidden']),
  reason: textSchema(1, 5000),
});
export const RollbackRequestSchema = z.strictObject({
  releaseId: IdSchema,
  reason: textSchema(1, 5000),
});
export const PersonaModerationSchema = z.strictObject({
  state: z.enum(['normal', 'blocked']),
  reason: textSchema(1, 5000).refine((value) => value.trim().length > 0, '请填写具体处理理由'),
  expectedRevision: z.number().int().positive(),
});
export const ReleaseActionSchema = z.strictObject({
  action: z.enum(['withdraw', 'block', 'restore']),
  reason: textSchema(1, 5000),
});
export const ReleasePathSchema = z.strictObject({ id: IdSchema, releaseId: IdSchema });
export const RestoreSubmissionSchema = z.strictObject({
  submissionId: IdSchema,
  expectedDraftRevision: z.number().int().positive(),
  confirmed: z.literal(true),
});
export const ReviewQueueSchema = z.strictObject({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN']).default('PENDING'),
  page: z.coerce.number().int().min(1).max(500).default(1),
});
export const defaultSubmissionPendingHint = '待审期间可以继续编辑草稿，修改不会改变本次审核快照';
export const SubmissionPendingHintSchema = textSchema(0, 500)
  .refine((value) => value === '' || value.trim().length > 0, '待审提示不能只包含空白')
  .refine(
    (value) =>
      Array.from(value).every(
        (character) => !/\p{Cc}/u.test(character) || ['\t', '\r', '\n'].includes(character),
      ),
    '待审提示不能包含不可见控制字符',
  );
export const SubmissionSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  platforms: z
    .array(PlatformSchema)
    .min(1, '请至少选择一个投稿平台')
    .max(2, '最多选择两个投稿平台')
    .refine((values) => new Set(values).size === values.length, '平台不能重复'),
  dailyQuota: z.number().int().min(1).max(100),
  pendingHint: SubmissionPendingHintSchema,
});
export const SubmissionPendingHintResponseSchema = z.strictObject({
  data: z.strictObject({ submissionId: IdSchema, pendingHint: SubmissionPendingHintSchema }),
  meta: z.strictObject({ settingsRevision: z.number().int().positive() }),
});
export type Submission = z.infer<typeof SubmissionSchema>;
