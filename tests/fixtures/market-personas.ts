import { MarketPersonaSchema, type Platform } from '@personamarket/contracts';

export function marketPersona(platform: Platform = 'maibot') {
  const content =
    platform === 'maibot'
      ? { personality: '  星光与书页\n第二行  ', replyStyle: '自然表达', behaviorStyle: '尊重边界' }
      : {
          systemPrompt: '  原样保留人格\n  ',
          dialoguePairs: [
            { user: '第一句', assistant: '第一答' },
            { user: '第二句', assistant: '第二答' },
          ],
        };
  return MarketPersonaSchema.parse({
    format: 'qingzheng-persona',
    schemaVersion: 1,
    platform,
    content,
    metadata: {
      title: '星光书房',
      summary: '从一个故事开始',
      categoryName: '日常',
      tagNames: ['温柔', '原创角色'],
      readmeMarkdown: '# 作者介绍\n\n保留原文与空白  \n',
      recommendedModels: [{ modelId: 'author/model', note: '作者明确填写' }],
      origin: {
        type: 'repost',
        redistribution: 'attribution_required',
        originalAuthor: '原作者',
        sourceUrl: 'https://example.org/original',
        sourceDescription: '作者公开分享',
        authorizationStatement: '包内声明，导入后仍需使用者核实',
      },
      authorNotes: '  使用说明  ',
    },
    assets: [],
    source: {
      publisherName: '公开发布者',
      version: '1.2.3',
      changelog: '冻结版本说明',
      personaUrl: 'https://example.org/personas/example',
    },
  });
}
