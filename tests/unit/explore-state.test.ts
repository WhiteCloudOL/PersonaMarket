import { expect, it } from 'vitest';
import { PublicPersonaQuerySchema } from '@personamarket/contracts';
import {
  exploreHref,
  hasExploreConstraints,
  exploreEmptyState,
} from '../../apps/web/src/lib/explore-state.js';

it('探索链接保留多标签AND、时间和对话条件，分页及视图可还原', () => {
  const query = PublicPersonaQuerySchema.parse({
    q: '星 河',
    tagIds: '20000000-0000-4000-8000-000000000001,20000000-0000-4000-8000-000000000002',
    platform: 'astrbot',
    publishedWithin: '7d',
    hasDialogue: 'true',
    featured: 'true',
    sort: 'updated',
    page: 2,
  });
  const url = new URL(exploreHref(query, 'list'), 'https://fixture.invalid');
  const { view, ...filters } = Object.fromEntries(url.searchParams);
  const restored = PublicPersonaQuerySchema.parse(filters);
  expect(restored).toEqual(query);
  expect(view).toBe('list');
});
it('默认相关度和空筛选使用简洁的公开地址，最近发布仍可明确分享', () => {
  expect(exploreHref(PublicPersonaQuerySchema.parse({}))).toBe('/explore');
  expect(exploreHref({ sort: 'newest' })).toBe('/explore?sort=newest');
});
it('真实空站点、限制条件无结果与越页按结果口径区分，排序视图不伪装为限制', () => {
  const empty = PublicPersonaQuerySchema.parse({ sort: 'updated', page: 1 });
  expect(hasExploreConstraints(empty)).toBe(false);
  expect(exploreEmptyState(empty, 0)).toBe('catalogue-empty');
  expect(exploreEmptyState({ ...empty, page: 9 }, 0)).toBe('catalogue-empty');
  expect(exploreEmptyState({ ...empty, page: 9 }, 2)).toBe('page-empty');
  for (const patch of [
    { q: '星河' },
    { platform: 'maibot' },
    { categoryId: '20000000-0000-4000-8000-000000000001' },
    { tagId: '20000000-0000-4000-8000-000000000001' },
    { tagIds: '20000000-0000-4000-8000-000000000001' },
    { model: 'long-model' },
    { origin: 'original' },
    { redistribution: 'attribution_required' },
    { publishedWithin: '7d' },
    { hasDialogue: 'false' },
    { featured: 'false' },
  ]) {
    const query = PublicPersonaQuerySchema.parse(patch);
    expect(hasExploreConstraints(query)).toBe(true);
    expect(exploreEmptyState(query, 0)).toBe('filtered-empty');
  }
});
it.each(['true', 'false'] as const)(
  '精选条件 %s 与平台、分页和视图一起往返，不接受模糊开关',
  (featured) => {
    const query = PublicPersonaQuerySchema.parse({ featured, platform: 'maibot', page: 2 });
    const url = new URL(exploreHref(query, 'list'), 'https://fixture.invalid');
    const { view, ...filters } = Object.fromEntries(url.searchParams);
    expect(PublicPersonaQuerySchema.parse(filters)).toEqual(query);
    expect(view).toBe('list');
    for (const invalid of ['yes', '1', true])
      expect(PublicPersonaQuerySchema.safeParse({ featured: invalid }).success).toBe(false);
  },
);
it.each(['downloads', 'recent-downloads', 'hot'] as const)(
  '有效导出排序 %s 与组合筛选、分页和列表视图可以一起分享还原',
  (sort) => {
    const query = PublicPersonaQuerySchema.parse({
      q: '星河',
      platform: 'astrbot',
      hasDialogue: 'true',
      sort,
      page: 2,
    });
    const url = new URL(exploreHref(query, 'list'), 'https://fixture.invalid');
    const { view, ...filters } = Object.fromEntries(url.searchParams);
    expect(PublicPersonaQuerySchema.parse(filters)).toEqual(query);
    expect(view).toBe('list');
  },
);
