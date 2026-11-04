import { describe, expect, it } from 'vitest';
import {
  DraftContentSchema,
  OriginDeclarationSchema,
  PersonaDraftSchema,
  PersonaContentSchema,
  PublicBrandSchema,
  PublicSnapshotSchema,
  createPersonaContentSchema,
  emptyPersonaDraft,
  textSchema,
} from '@personamarket/contracts';
import { astrbotContent, maibotContent, publicSnapshot } from '../fixtures/persona.js';

describe('平台与快照契约', () => {
  it('保留作者输入，拒绝跨平台字段和客户端身份', () => {
    expect(PersonaContentSchema.parse(maibotContent)).toEqual(maibotContent);
    expect(PersonaContentSchema.safeParse({ ...maibotContent, ownerId: 'forged' }).success).toBe(
      false,
    );
    expect(
      PersonaContentSchema.safeParse({
        ...maibotContent,
        content: { ...maibotContent.content, systemPrompt: '跨平台' },
      }).success,
    ).toBe(false);
  });
  it('接受完整公开快照，拒绝私有证据混入', () => {
    expect(PublicSnapshotSchema.safeParse(publicSnapshot).success).toBe(true);
    expect(
      PublicSnapshotSchema.safeParse({ ...publicSnapshot, authorizationEvidenceId: 'private' })
        .success,
    ).toBe(false);
  });
  it('AstrBot 允许零对对话，拒绝单侧空白和重复行 ID', () => {
    expect(PersonaContentSchema.parse(astrbotContent)).toEqual(astrbotContent);
    const pair = { id: '11111111-1111-4111-8111-111111111111', user: '你好', assistant: '你好呀' };
    expect(
      PersonaContentSchema.safeParse({
        platform: 'astrbot',
        content: { systemPrompt: '人格', dialoguePairs: [{ ...pair, assistant: ' ' }] },
      }).success,
    ).toBe(false);
    expect(
      PersonaContentSchema.safeParse({
        platform: 'astrbot',
        content: { systemPrompt: '人格', dialoguePairs: [pair, pair] },
      }).success,
    ).toBe(false);
  });
  it('按 Unicode code point 而非 UTF-16 计数', () => {
    expect(textSchema(2, 2).safeParse('🦆鸭').success).toBe(true);
    expect(textSchema(2, 2).safeParse('🦆').success).toBe(false);
  });
  it('草稿可不完整；收紧发布上限不会截断可保存内容', () => {
    expect(
      DraftContentSchema.safeParse({
        ...maibotContent,
        content: { personality: '', replyStyle: '', behaviorStyle: '' },
      }).success,
    ).toBe(true);
    expect(DraftContentSchema.parse(maibotContent)).toEqual(maibotContent);
    const tightened = createPersonaContentSchema({
      maibotField: 1,
      astrbotPrompt: 20_000,
      dialoguePairs: 20,
      dialogueMessage: 2_000,
    });
    expect(tightened.safeParse(maibotContent).success).toBe(false);
  });
  it('来源和转载许可仍必选，授权证据和说明可留空', () => {
    expect(
      OriginDeclarationSchema.safeParse({
        type: 'repost',
        originalAuthor: '作者',
        authorizationStatement: '获得许可',
        redistribution: 'not_allowed',
      }).success,
    ).toBe(true);
    expect(
      OriginDeclarationSchema.safeParse({ type: 'original', redistribution: 'custom' }).success,
    ).toBe(true);
    expect(OriginDeclarationSchema.safeParse({ type: 'repost' }).success).toBe(false);
    expect(OriginDeclarationSchema.safeParse({ redistribution: 'not_allowed' }).success).toBe(
      false,
    );
  });
  it('自定义标签可以保存，推荐与自定义合计最多八个且不得重名', () => {
    const draft = emptyPersonaDraft('maibot');
    expect(PersonaDraftSchema.parse({ ...draft, customTags: [' 夜读 '] }).customTags).toEqual([
      '夜读',
    ]);
    expect(PersonaDraftSchema.safeParse({ ...draft, customTags: ['Lore', 'lore'] }).success).toBe(
      false,
    );
    expect(
      PersonaDraftSchema.safeParse({
        ...draft,
        tagIds: ['11111111-1111-4111-8111-111111111111'],
        customTags: Array.from({ length: 8 }, (_, index) => `标签 ${index}`),
      }).success,
    ).toBe(false);
  });
  it('公开白名单剔除数据库中的私有字段', () => {
    const result = PublicBrandSchema.parse({
      name: '测试站点',
      description: '站点描述',
      defaultLocale: 'zh-CN',
      smtpPassword: 'private-value',
    });
    expect(result).not.toHaveProperty('smtpPassword');
  });
});
