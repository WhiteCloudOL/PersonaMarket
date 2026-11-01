import { describe, expect, it } from 'vitest';
import {
  MarketPersonaSchema,
  MARKET_SCHEMA_ID,
  marketPersonaJsonSchema,
} from '@personamarket/contracts';

const key = '3cabba2c-340d-4edb-8357-a1404f6f878a';
const image = {
  key,
  path: `assets/${key}.webp`,
  mimeType: 'image/webp',
  bytes: 128,
  sha256: 'a'.repeat(64),
};
function document() {
  return {
    format: 'qingzheng-persona',
    schemaVersion: 1,
    platform: 'maibot',
    content: {
      personality: '  星光与角色\n第二行\t🪄  ',
      replyStyle: '自然表达',
      behaviorStyle: '尊重原文',
    },
    metadata: {
      title: '星光书房',
      summary: '保留创作内容',
      categoryName: '日常',
      tagNames: ['原创', '温柔'],
      readmeMarkdown: '# 介绍\n\n作者自行填写',
      recommendedModels: [{ modelId: 'author/model', note: '作者推荐' }],
      origin: { type: 'original', redistribution: 'attribution_required' },
      authorNotes: '  原作者说明  ',
    },
    assets: [],
    source: {
      publisherName: '公开发布者',
      version: '1.0.0',
      changelog: '首次发布',
    },
  };
}

describe('本站通用人设文件契约', () => {
  it('保留作者空白、Unicode、模型、分类标签名称和来源，不依赖源站内部身份', () => {
    const value = document();
    expect(MarketPersonaSchema.parse(value)).toEqual(value);
    expect(MarketPersonaSchema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);
  });

  it('AstrBot保持对话原始顺序，不接受包携带的行ID或能力配置', () => {
    const value = {
      ...document(),
      platform: 'astrbot',
      content: {
        systemPrompt: '  人格\n  ',
        dialoguePairs: [
          { user: '第一句', assistant: '第一答' },
          { user: '第二句', assistant: '第二答' },
        ],
      },
    };
    expect(MarketPersonaSchema.parse(value)).toEqual(value);
    expect(
      MarketPersonaSchema.safeParse({
        ...value,
        content: { ...value.content, tools: ['execute'] },
      }).success,
    ).toBe(false);
    expect(
      MarketPersonaSchema.safeParse({
        ...value,
        content: { ...value.content, dialoguePairs: [{ id: key, user: '问', assistant: '答' }] },
      }).success,
    ).toBe(false);
  });

  it('未知身份、权限、审核、证据和统计字段均不能进入可迁移文件', () => {
    for (const [field, value] of Object.entries({
      ownerId: key,
      role: 'admin',
      moderationState: 'approved',
      likes: 123,
      secret: 'synthetic-only',
    })) {
      expect(MarketPersonaSchema.safeParse({ ...document(), [field]: value }).success).toBe(false);
    }
    for (const [field, value] of Object.entries({
      rightsAccepted: true,
      categoryId: key,
      tagIds: [key],
      evidenceAssetIds: [key],
    })) {
      const data = document();
      expect(
        MarketPersonaSchema.safeParse({
          ...data,
          metadata: { ...data.metadata, [field]: value },
        }).success,
      ).toBe(false);
    }
  });

  it('拒绝未知格式版本和跨平台正文，不猜测无损转换', () => {
    for (const data of [
      { ...document(), schemaVersion: 2 },
      { ...document(), format: 'astrbot' },
      { ...document(), platform: 'astrbot' },
      { ...document(), content: { ...document().content, systemPrompt: '混入' } },
    ])
      expect(MarketPersonaSchema.safeParse(data).success).toBe(false);
  });

  it('素材引用必须指向清单，声明不能重复或混合在线与包内介质', () => {
    const value = document();
    const metadata = { ...value.metadata, avatarKey: key, coverKey: key };
    expect(MarketPersonaSchema.safeParse({ ...value, metadata }).success).toBe(false);
    expect(MarketPersonaSchema.safeParse({ ...value, metadata, assets: [image] }).success).toBe(
      true,
    );
    expect(MarketPersonaSchema.safeParse({ ...value, assets: [image, image] }).success).toBe(false);
    const { path, ...online } = image;
    void path;
    expect(
      MarketPersonaSchema.safeParse({
        ...value,
        assets: [
          image,
          {
            ...online,
            key: '8c248fec-d511-4e8c-a1bf-a66a05c1e532',
            url: 'https://example.org/image.webp',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('清单路径、声明类型、哈希和字节预算具有固定边界', () => {
    for (const change of [
      { path: '../image.webp' },
      { path: `assets/${key}.png` },
      { path: 'assets/8c248fec-d511-4e8c-a1bf-a66a05c1e532.webp' },
      { mimeType: 'image/svg+xml' },
      { sha256: 'unknown' },
      { bytes: 0 },
      { bytes: 5 * 1024 * 1024 + 1 },
      { url: 'https://example.org/image.webp' },
    ])
      expect(
        MarketPersonaSchema.safeParse({
          ...document(),
          assets: [{ ...image, ...change }],
        }).success,
      ).toBe(false);
  });

  it('在线引用不包含凭据或脚本协议，仅声明地址而不会执行取图', () => {
    const { path, ...online } = image;
    void path;
    for (const url of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'https://user:password@example.org/a.webp',
    ])
      expect(
        MarketPersonaSchema.safeParse({ ...document(), assets: [{ ...online, url }] }).success,
      ).toBe(false);
  });

  it('拒绝超出字符/条目边界以及重复标签，不裁剪作者内容', () => {
    for (const change of [
      { title: '字'.repeat(81) },
      { title: '\ud800' },
      { title: '\u0000' },
      { summary: '🪄'.repeat(201) },
      { tagNames: ['重复', '重复'] },
      { recommendedModels: Array.from({ length: 6 }, () => ({ modelId: 'model' })) },
    ])
      expect(
        MarketPersonaSchema.safeParse({
          ...document(),
          metadata: { ...document().metadata, ...change },
        }).success,
      ).toBe(false);
    expect(
      MarketPersonaSchema.safeParse({
        ...document(),
        metadata: { ...document().metadata, summary: '🪄'.repeat(200) },
      }).success,
    ).toBe(true);
  });

  it('从同一Zod契约生成可保存的JSON Schema，公开版本标识无需虚构站点域名', () => {
    const schema = marketPersonaJsonSchema();
    expect(schema.$id).toBe(MARKET_SCHEMA_ID);
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
    expect(JSON.stringify(schema)).toContain('additionalProperties');
  });
});
