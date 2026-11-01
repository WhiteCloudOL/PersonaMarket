import { z } from 'zod';
import { IdSchema, PlatformSchema, textSchema } from './common.js';

export const ContentLimitsSchema = z.strictObject({
  maibotField: z.number().int().min(1).max(20_000),
  astrbotPrompt: z.number().int().min(1).max(100_000),
  dialoguePairs: z.number().int().min(1).max(100),
  dialogueMessage: z.number().int().min(1).max(20_000),
});
export const defaultContentLimits = {
  maibotField: 2_000,
  astrbotPrompt: 20_000,
  dialoguePairs: 20,
  dialogueMessage: 2_000,
} as const;
export type ContentLimits = z.infer<typeof ContentLimitsSchema>;

export function createPersonaContentSchema(limits: ContentLimits = defaultContentLimits) {
  const checked = ContentLimitsSchema.parse(limits);
  const pair = z.strictObject({
    id: IdSchema,
    user: textSchema(1, checked.dialogueMessage),
    assistant: textSchema(1, checked.dialogueMessage),
  });
  return z.discriminatedUnion('platform', [
    z.strictObject({
      platform: z.literal('maibot'),
      content: z.strictObject({
        personality: textSchema(1, checked.maibotField),
        replyStyle: textSchema(1, checked.maibotField),
        behaviorStyle: textSchema(1, checked.maibotField),
      }),
    }),
    z.strictObject({
      platform: z.literal('astrbot'),
      content: z.strictObject({
        systemPrompt: textSchema(1, checked.astrbotPrompt),
        dialoguePairs: z
          .array(pair)
          .max(checked.dialoguePairs)
          .refine(
            (pairs) => new Set(pairs.map((item) => item.id)).size === pairs.length,
            '对话行标识不能重复',
          ),
      }),
    }),
  ]);
}

export const PersonaContentSchema = createPersonaContentSchema();
export type PersonaContent = z.infer<typeof PersonaContentSchema>;
// 草稿仅受部署级边界约束；发布时另用当前业务上限校验，不能截断旧草稿。
export const DraftContentSchema = z.discriminatedUnion('platform', [
  z.strictObject({
    platform: z.literal('maibot'),
    content: z.strictObject({
      personality: textSchema(0, 20_000),
      replyStyle: textSchema(0, 20_000),
      behaviorStyle: textSchema(0, 20_000),
    }),
  }),
  z.strictObject({
    platform: z.literal('astrbot'),
    content: z.strictObject({
      systemPrompt: textSchema(0, 100_000),
      dialoguePairs: z
        .array(
          z.strictObject({
            id: IdSchema,
            user: textSchema(0, 20_000),
            assistant: textSchema(0, 20_000),
          }),
        )
        .max(100)
        .refine(
          (pairs) => new Set(pairs.map((pair) => pair.id)).size === pairs.length,
          '对话行标识不能重复',
        ),
    }),
  }),
]);

export const RedistributionSchema = z.enum([
  'not_allowed',
  'attribution_required',
  'contact_required',
  'custom',
]);
const sharedOrigin = {
  redistribution: RedistributionSchema,
  policyText: textSchema(0, 5_000).optional(),
};
export const OriginDeclarationSchema = z
  .discriminatedUnion('type', [
    z.strictObject({ type: z.literal('original'), ...sharedOrigin }),
    z.strictObject({
      type: z.literal('repost'),
      ...sharedOrigin,
      originalAuthor: textSchema(1, 100),
      sourceUrl: z.url({ protocol: /^https?$/ }).optional(),
      sourceDescription: textSchema(1, 2_000).optional(),
      authorizationStatement: textSchema(1, 5_000),
    }),
  ])
  .superRefine((origin, context) => {
    if (origin.redistribution === 'custom' && !origin.policyText?.trim()) {
      context.addIssue({ code: 'custom', path: ['policyText'], message: '请填写自定义转载规则' });
    }
    if (origin.type === 'repost' && !origin.sourceUrl && !origin.sourceDescription?.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['sourceDescription'],
        message: '请提供来源链接或来源说明',
      });
    }
  });

const SnapshotMetadataSchema = z.strictObject({
  schemaVersion: z.literal(1),
  title: textSchema(2, 80),
  summary: textSchema(1, 200),
  categoryId: IdSchema,
  tagIds: z.array(IdSchema).max(8),
  avatarAssetId: IdSchema.optional(),
  coverAssetId: IdSchema.optional(),
  readmeMarkdown: textSchema(0, 30_000),
  authorNotes: textSchema(0, 2000).optional(),
  recommendedModels: z
    .array(z.strictObject({ modelId: textSchema(1, 200), note: textSchema(0, 500).optional() }))
    .max(5),
  origin: OriginDeclarationSchema,
});
export const PublicCardSnapshotSchema = SnapshotMetadataSchema.pick({
  title: true,
  summary: true,
  categoryId: true,
  tagIds: true,
  avatarAssetId: true,
  coverAssetId: true,
}).extend({
  platform: PlatformSchema,
  origin: z.strictObject({
    type: z.enum(['original', 'repost']),
    redistribution: RedistributionSchema,
  }),
});
export function createPublicSnapshotSchema(limits: ContentLimits = defaultContentLimits) {
  return createPersonaContentSchema(limits).and(SnapshotMetadataSchema);
}
// 历史快照仅校验绝对边界，当前发布上限单独在提交事务中检查。
export const PublicSnapshotSchema = createPublicSnapshotSchema({
  maibotField: 20000,
  astrbotPrompt: 100000,
  dialoguePairs: 100,
  dialogueMessage: 20000,
});
