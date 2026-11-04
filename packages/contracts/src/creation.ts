import { z } from 'zod';
import { IdSchema, PlatformSchema, TimestampSchema, textSchema } from './common.js';
import {
  DraftContentSchema,
  ContentLimitsSchema,
  defaultContentLimits,
  RedistributionSchema,
} from './persona.js';

const commonOrigin = {
  redistribution: RedistributionSchema,
  policyText: textSchema(0, 5000).optional(),
};
export const DraftOriginSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('original'), ...commonOrigin }),
  z.strictObject({
    type: z.literal('repost'),
    ...commonOrigin,
    originalAuthor: textSchema(0, 100).optional(),
    sourceUrl: z.union([z.literal(''), z.url({ protocol: /^https?$/ })]).optional(),
    sourceDescription: textSchema(0, 2000).optional(),
    authorizationStatement: textSchema(0, 5000).optional(),
  }),
]);
export const MAX_PERSONA_TAGS = 8;
export const CustomPersonaTagSchema = z
  .string()
  .trim()
  .min(1)
  .max(24)
  .regex(/^[^\p{Cc}\p{Cf}]+$/u);
export const DraftMetadataSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    title: textSchema(0, 80),
    summary: textSchema(0, 200),
    categoryId: IdSchema.nullable(),
    tagIds: z
      .array(IdSchema)
      .max(MAX_PERSONA_TAGS)
      .refine((ids) => new Set(ids).size === ids.length, '标签不能重复'),
    customTags: z.array(CustomPersonaTagSchema).max(MAX_PERSONA_TAGS).optional(),
    readmeMarkdown: textSchema(0, 30000),
    recommendedModels: z
      .array(z.strictObject({ modelId: textSchema(0, 200), note: textSchema(0, 500).optional() }))
      .max(5),
    origin: DraftOriginSchema,
    authorNotes: textSchema(0, 2000),
    rightsAccepted: z.boolean(),
    avatarAssetId: IdSchema.optional(),
    coverAssetId: IdSchema.optional(),
    evidenceAssetIds: z.array(IdSchema).max(5),
  })
  .superRefine(({ tagIds, customTags = [] }, context) => {
    if (
      tagIds.length + customTags.length > MAX_PERSONA_TAGS ||
      new Set(customTags.map((name) => name.toLowerCase())).size !== customTags.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['customTags'],
        message: '标签不能重复，最多添加 8 个',
      });
    }
  });
export const PersonaDraftSchema = DraftContentSchema.and(DraftMetadataSchema);
export type PersonaDraft = z.infer<typeof PersonaDraftSchema>;
/** 只选公开字段；私有授权证据与作者确认不进入版本正文。 */
export function publicSnapshotCandidate(draft: PersonaDraft) {
  const { rightsAccepted, evidenceAssetIds, customTags, ...fields } = draft;
  void rightsAccepted;
  void evidenceAssetIds;
  void customTags;
  const origin =
    draft.origin.type === 'repost'
      ? {
          ...draft.origin,
          ...(!draft.origin.sourceUrl ? { sourceUrl: undefined } : {}),
          ...(!draft.origin.sourceDescription?.trim() ? { sourceDescription: undefined } : {}),
        }
      : draft.origin;
  return { ...fields, origin };
}
export const CreatePersonaSchema = z
  .strictObject({
    platform: PlatformSchema,
    title: textSchema(0, 80),
    initialDraft: PersonaDraftSchema.optional(),
  })
  .superRefine((input, context) => {
    if (!input.initialDraft) return;
    if (input.initialDraft.platform !== input.platform)
      context.addIssue({
        code: 'custom',
        path: ['initialDraft', 'platform'],
        message: '初始草稿的平台与选择的平台不一致',
      });
    if (input.initialDraft.title !== input.title)
      context.addIssue({
        code: 'custom',
        path: ['initialDraft', 'title'],
        message: '初始草稿的人设名称不一致',
      });
  });
export type CreatePersonaRequest = z.infer<typeof CreatePersonaSchema>;
export const PersonaIdSchema = z.strictObject({ id: IdSchema });
export const DraftResponseSchema = z.strictObject({
  data: z.strictObject({
    id: IdSchema,
    draft: PersonaDraftSchema,
    ownerVisibility: z.enum(['listed', 'hidden']),
    moderationState: z.enum(['normal', 'blocked']),
    updatedAt: TimestampSchema,
  }),
  meta: z.strictObject({ revision: z.number().int().positive() }),
});
export type DraftResponse = z.infer<typeof DraftResponseSchema>;
export const PersonaSummarySchema = z.strictObject({
  id: IdSchema,
  platform: PlatformSchema,
  title: z.string(),
  ownerVisibility: z.enum(['listed', 'hidden']),
  moderationState: z.enum(['normal', 'blocked']),
  publishedReleaseId: IdSchema.nullable(),
  latestSubmissionStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN']).nullable(),
  updatedAt: TimestampSchema,
});
export const MyPersonasResponseSchema = z.strictObject({
  data: z.array(PersonaSummarySchema),
  meta: z.strictObject({ page: z.number(), pageSize: z.number(), total: z.number() }),
});
export const TaxonomyResponseSchema = z.strictObject({
  data: z.strictObject({
    categories: z.array(z.strictObject({ id: IdSchema, name: z.string() })),
    tags: z.array(z.strictObject({ id: IdSchema, name: z.string() })),
    contentLimits: ContentLimitsSchema,
  }),
});
export const GENERAL_CATEGORY_ID = '00000000-0000-4000-8000-000000000001';
export function emptyPersonaDraft(
  platform: z.infer<typeof PlatformSchema>,
  title = '',
): PersonaDraft {
  return PersonaDraftSchema.parse({
    schemaVersion: 1,
    title,
    summary: '',
    categoryId: GENERAL_CATEGORY_ID,
    tagIds: [],
    readmeMarkdown: '',
    recommendedModels: [],
    origin: { type: 'original', redistribution: 'contact_required' },
    authorNotes: '',
    rightsAccepted: false,
    evidenceAssetIds: [],
    ...(platform === 'maibot'
      ? { platform, content: { personality: '', replyStyle: '', behaviorStyle: '' } }
      : { platform, content: { systemPrompt: '', dialoguePairs: [] } }),
  });
}
export const initialContentSettings = { ...defaultContentLimits };
