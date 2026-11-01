import { FavoritesQuerySchema, type FavoritesQuery } from '@personamarket/contracts';
const keys = ['page', 'pageSize', 'sort', 'platform', 'availability', 'q'] as const;
export function readFavoritesState(params: URLSearchParams) {
  const parsed = FavoritesQuerySchema.safeParse(Object.fromEntries(params));
  const duplicate = keys.some((key) => params.getAll(key).length > 1);
  return parsed.success && !duplicate
    ? { input: parsed.data, invalid: false }
    : { input: FavoritesQuerySchema.parse({}), invalid: true };
}
export function favoritesHref(input: FavoritesQuery) {
  const params = new URLSearchParams();
  for (const key of keys) {
    const value = input[key];
    if (
      value === undefined ||
      value === '' ||
      (key === 'page' && value === 1) ||
      (key === 'pageSize' && value === 20) ||
      (key === 'sort' && value === 'newest') ||
      (key === 'availability' && value === 'all')
    )
      continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return '/dashboard/favorites' + (query ? '?' + query : '');
}
