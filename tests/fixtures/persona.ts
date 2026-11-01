export const maibotContent = {
  platform: 'maibot' as const,
  content: {
    personality: ' 温和且好奇，喜欢分享观察。\n',
    replyStyle: '简洁自然。',
    behaviorStyle: '先确认事实。',
  },
};
export const astrbotContent = {
  platform: 'astrbot' as const,
  content: { systemPrompt: '你是一位耐心的向导。', dialoguePairs: [] },
};
export const publicSnapshot = {
  ...maibotContent,
  schemaVersion: 1,
  title: '耐心的向导',
  summary: '用简单语言解释复杂事物。',
  categoryId: '11111111-1111-4111-8111-111111111111',
  tagIds: [],
  readmeMarkdown: '',
  recommendedModels: [],
  origin: { type: 'original', redistribution: 'attribution_required' },
};
