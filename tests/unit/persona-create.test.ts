import { describe, expect, it } from 'vitest';
import { CreatePersonaSchema, emptyPersonaDraft } from '@personamarket/contracts';

describe('完整草稿初始化契约', () => {
  it('保留名称与平台的既有创建请求，也可原样提交完整初始草稿', () => {
    expect(CreatePersonaSchema.parse({ platform: 'maibot', title: '' })).toEqual({
      platform: 'maibot',
      title: '',
    });
    for (const platform of ['maibot', 'astrbot'] as const) {
      const initialDraft = {
        ...emptyPersonaDraft(platform, '星光书房'),
        summary: '  原样保留简介与空白  ',
        readmeMarkdown: '# 角色故事\n\n来自春日书房',
        recommendedModels: [{ modelId: 'author/model', note: '作者推荐' }],
      };
      const request = { platform, title: initialDraft.title, initialDraft };
      expect(CreatePersonaSchema.parse(request)).toEqual(request);
    }
  });

  it('拒绝初始草稿与外层平台或标题不一致', () => {
    const initialDraft = emptyPersonaDraft('maibot', '星光书房');
    expect(
      CreatePersonaSchema.safeParse({
        platform: 'astrbot',
        title: initialDraft.title,
        initialDraft,
      }).success,
    ).toBe(false);
    expect(
      CreatePersonaSchema.safeParse({ platform: 'maibot', title: '另一个标题', initialDraft })
        .success,
    ).toBe(false);
  });

  it('完整创建仍拒绝身份/状态注入与超出绝对边界的内容', () => {
    const initialDraft = emptyPersonaDraft('maibot', '星光书房');
    const request = { platform: 'maibot', title: initialDraft.title, initialDraft };
    expect(CreatePersonaSchema.safeParse({ ...request, ownerId: 'forged-owner' }).success).toBe(
      false,
    );
    expect(
      CreatePersonaSchema.safeParse({
        ...request,
        initialDraft: { ...initialDraft, moderationState: 'approved' },
      }).success,
    ).toBe(false);
    expect(
      CreatePersonaSchema.safeParse({
        ...request,
        initialDraft: { ...initialDraft, summary: '长'.repeat(201) },
      }).success,
    ).toBe(false);
  });
});
