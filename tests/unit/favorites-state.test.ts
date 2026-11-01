import { expect, it } from 'vitest';
import { favoritesHref, readFavoritesState } from '../../apps/web/src/lib/favorites-state.js';
it('收藏筛选分页保留可分享URL，默认值不污染地址', () => {
  const state = readFavoritesState(
    new URLSearchParams(
      'platform=astrbot&availability=unavailable&sort=oldest&q=%E6%98%9F%E5%85%89&page=2',
    ),
  ).input;
  const href = favoritesHref(state);
  expect(readFavoritesState(new URLSearchParams(href.split('?')[1])).input).toEqual(state);
  expect(favoritesHref(readFavoritesState(new URLSearchParams()).input)).toBe(
    '/dashboard/favorites',
  );
});
it('非法或重复参数回到默认条件并显式标记，不接受另一个用户身份', () => {
  for (const value of ['page=0', 'page=1&page=2', 'platform=both', 'sort=sql', 'userId=other']) {
    const result = readFavoritesState(new URLSearchParams(value));
    expect(result.invalid).toBe(true);
    expect(favoritesHref(result.input)).toBe('/dashboard/favorites');
  }
});
