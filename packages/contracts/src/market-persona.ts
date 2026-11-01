// 本站通用人设文件只承载可迁移内容，不承载本站身份或审核结果
import { z } from 'zod';
import { IdSchema, textSchema } from './common.js';
import { RedistributionSchema } from './persona.js';
import { IMPORT_TEXT_MAX_BYTES } from './import-text.js';

export const MARKET_FORMAT = 'qingzheng-persona' as const;
export const MARKET_SCHEMA_VERSION = 1 as const;
// 与部署级 JSON/TOML/文本文件边界一致，不能借扩展格式放宽全站请求限制
export const MARKET_DOCUMENT_MAX_BYTES = IMPORT_TEXT_MAX_BYTES;
export const MARKET_SCHEMA_ID = 'urn:uuid:4a2d4267-a0fa-4016-b9ef-90e4f4dfb7c8' as const;
export const MARKET_ASSET_MAX_BYTES = 5 * 1024 * 1024;
export const MARKET_ASSET_MAX_COUNT = 22;
export const MARKET_ARCHIVE_MAX_BYTES = 128 * 1024 * 1024;
export const MARKET_ARCHIVE_INFLATED_MAX_BYTES = 160 * 1024 * 1024;
export const MARKET_ARCHIVE_MAX_ENTRIES = 128;

const portableText = (min: number, max: number) =>
  textSchema(min, max)
    .refine(
      (value) =>
        Array.from(value).every((character) => {
          const code = character.codePointAt(0) ?? 0;
          return code !== 0 && (code < 0xd800 || code > 0xdfff);
        }),
      '文字包含无效的 Unicode 字符或空字符',
    )
    .meta({ minLength: min, maxLength: max });
export const MarketAssetKeySchema = IdSchema.regex(/^[a-f0-9-]{36}$/);
const sourceUrl = z
  .url({ protocol: /^https?$/ })
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      Array.from(value).every((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code > 32 && code !== 127 && (code < 0xd800 || code > 0xdfff);
      })
    );
  }, '请提供不含凭据的有效 HTTP 或 HTTPS 地址');
const portablePolicy = {
  redistribution: RedistributionSchema,
  policyText: portableText(0, 5000).optional(),
};
const portableOrigin = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('original'), ...portablePolicy }),
  z.strictObject({
    type: z.literal('repost'),
    ...portablePolicy,
    originalAuthor: portableText(0, 100),
    sourceUrl: sourceUrl.optional(),
    sourceDescription: portableText(0, 2000).optional(),
    authorizationStatement: portableText(0, 5000),
  }),
]);
const asset = {
  key: MarketAssetKeySchema,
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  bytes: z.number().int().min(1).max(MARKET_ASSET_MAX_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
};
export const MarketAssetSchema = z.union([
  z.strictObject({
    ...asset,
    path: z.string().regex(/^assets\/[a-f0-9-]{36}\.(png|jpe?g|webp)$/),
  }),
  z.strictObject({ ...asset, url: sourceUrl }),
]);
export const MarketMetadataSchema = z.strictObject({
  title: portableText(0, 80),
  summary: portableText(0, 200),
  categoryName: portableText(1, 80).optional(),
  tagNames: z.array(portableText(1, 80)).max(8),
  readmeMarkdown: portableText(0, 30000),
  recommendedModels: z
    .array(
      z.strictObject({
        modelId: portableText(0, 200),
        note: portableText(0, 500).optional(),
      }),
    )
    .max(5),
  origin: portableOrigin,
  authorNotes: portableText(0, 2000),
  avatarKey: MarketAssetKeySchema.optional(),
  coverKey: MarketAssetKeySchema.optional(),
});
const common = {
  format: z.literal(MARKET_FORMAT),
  schemaVersion: z.literal(MARKET_SCHEMA_VERSION),
  metadata: MarketMetadataSchema,
  assets: z.array(MarketAssetSchema).max(MARKET_ASSET_MAX_COUNT),
  // 仅为来源说明，不恢复源站账号、审核结果、统计或发布时间
  source: z
    .strictObject({
      siteUrl: sourceUrl.optional(),
      personaUrl: sourceUrl.optional(),
      publisherName: portableText(0, 100).optional(),
      version: portableText(1, 80).optional(),
      changelog: portableText(0, 5000).optional(),
    })
    .optional(),
};
export const MarketPersonaSchema = z
  .discriminatedUnion('platform', [
    z.strictObject({
      ...common,
      platform: z.literal('maibot'),
      content: z.strictObject({
        personality: portableText(0, 20000),
        replyStyle: portableText(0, 20000),
        behaviorStyle: portableText(0, 20000),
      }),
    }),
    z.strictObject({
      ...common,
      platform: z.literal('astrbot'),
      content: z.strictObject({
        systemPrompt: portableText(0, 100000),
        dialoguePairs: z
          .array(
            z.strictObject({
              user: portableText(0, 20000),
              assistant: portableText(0, 20000),
            }),
          )
          .max(100),
      }),
    }),
  ])
  .superRefine((document, context) => {
    const keys = new Set<string>();
    const media = new Set<string>();
    for (const [index, item] of document.assets.entries()) {
      if (keys.has(item.key))
        context.addIssue({
          code: 'custom',
          path: ['assets', index, 'key'],
          message: '素材键不能重复',
        });
      keys.add(item.key);
      media.add('path' in item ? 'path' : 'url');
      if ('path' in item) {
        const expected = 'assets/' + item.key + '.';
        if (!item.path.startsWith(expected))
          context.addIssue({
            code: 'custom',
            path: ['assets', index, 'path'],
            message: '素材路径与包内键不一致',
          });
        const extension = item.path.split('.').at(-1);
        const valid =
          item.mimeType === 'image/jpeg'
            ? extension === 'jpg' || extension === 'jpeg'
            : extension === (item.mimeType === 'image/png' ? 'png' : 'webp');
        if (!valid)
          context.addIssue({
            code: 'custom',
            path: ['assets', index, 'mimeType'],
            message: '素材类型与路径扩展名不一致',
          });
      }
    }
    if (media.size > 1)
      context.addIssue({
        code: 'custom',
        path: ['assets'],
        message: '包内素材与在线引用不能混用',
      });
    for (const field of ['avatarKey', 'coverKey'] as const) {
      const key = document.metadata[field];
      if (key && !keys.has(key))
        context.addIssue({
          code: 'custom',
          path: ['metadata', field],
          message: '图片引用不在素材清单中',
        });
    }
    if (new Set(document.metadata.tagNames).size !== document.metadata.tagNames.length)
      context.addIssue({
        code: 'custom',
        path: ['metadata', 'tagNames'],
        message: '标签名称不能重复',
      });
  });
export type MarketPersona = z.infer<typeof MarketPersonaSchema>;
export function marketPersonaJsonSchema() {
  return {
    ...z.toJSONSchema(MarketPersonaSchema, { target: 'draft-2020-12', io: 'input' }),
    $id: MARKET_SCHEMA_ID,
    title: '清蒸云鸭人设通用格式 v1',
    description: '结构校验之外仍须验证图片清单、实际字节、哈希、Markdown引用和资源权限',
  };
}

// Markdown引用、介质、实际文件和权限由适配器与业务层继续校验
