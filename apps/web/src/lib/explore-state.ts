import type { PublicPersonaQuery } from '@personamarket/contracts';
export function hasExploreConstraints(query: PublicPersonaQuery) {
  return Boolean(
    query.q.trim() ||
    query.platform ||
    query.categoryId ||
    query.tagId ||
    query.tagIds ||
    query.model ||
    query.origin ||
    query.redistribution ||
    (query.publishedWithin && query.publishedWithin !== 'all') ||
    query.hasDialogue ||
    query.featured,
  );
}
export function exploreEmptyState(query: PublicPersonaQuery, total: number) {
  if (total > 0) return 'page-empty';
  return hasExploreConstraints(query) ? 'filtered-empty' : 'catalogue-empty';
}
export function exploreHref(query: Partial<PublicPersonaQuery>, view: 'grid' | 'list' = 'grid') {
  const params = new URLSearchParams();
  for (const key of [
    'q',
    'platform',
    'categoryId',
    'tagId',
    'tagIds',
    'model',
    'origin',
    'redistribution',
    'hasDialogue',
    'featured',
  ] as const) {
    const value = query[key];
    if (value) params.set(key, value);
  }
  if (query.page && query.page > 1) params.set('page', String(query.page));
  if (query.publishedWithin && query.publishedWithin !== 'all')
    params.set('publishedWithin', query.publishedWithin);
  if (query.sort && query.sort !== 'relevance') params.set('sort', query.sort);
  if (view !== 'grid') params.set('view', view);
  const search = params.toString();
  return '/explore' + (search ? '?' + search : '');
}
