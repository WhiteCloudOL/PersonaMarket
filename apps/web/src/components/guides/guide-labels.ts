import type { GuideFields, GuideSlug } from '@personamarket/contracts';
import { guideSections } from './guide-sections';

export const guideStatuses = { draft: '尚未发布', published: '已公开', withdrawn: '已撤回' };
export function guideLabel(slug: GuideSlug) {
  return guideSections.find((item) => item.id === slug)?.title ?? slug;
}
export function guideFields(value: GuideFields): GuideFields {
  return { title: value.title, summary: value.summary, bodyMarkdown: value.bodyMarkdown };
}
