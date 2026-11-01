import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  FavoriteSchema,
  FavoritesQuerySchema,
  InteractionBatchQuerySchema,
  InteractionCountsSchema,
} from '@personamarket/contracts';

it('批量状态读取与收藏页输入有界，拒绝客户端身份和无效排序', () => {
  expect(
    InteractionBatchQuerySchema.safeParse({
      ids: Array.from({ length: 50 }, () => randomUUID()).join(','),
    }).success,
  ).toBe(true);
  for (const ids of ['', 'invalid', Array.from({ length: 51 }, () => randomUUID()).join(',')])
    expect(InteractionBatchQuerySchema.safeParse({ ids }).success).toBe(false);
  for (const input of [
    { userId: randomUUID() },
    { page: 0 },
    { pageSize: 21 },
    { sort: 'sql' },
    { platform: 'both' },
  ])
    expect(FavoritesQuerySchema.safeParse(input).success).toBe(false);
});
it('不可用收藏契约不接受旧标题正文或作者，计数不能为负或伪造个人状态', () => {
  const placeholder = {
    available: false,
    personaId: randomUUID(),
    savedAt: new Date().toISOString(),
  };
  expect(FavoriteSchema.safeParse(placeholder).success).toBe(true);
  for (const field of ['title', 'snapshot', 'ownerId', 'releaseId'])
    expect(FavoriteSchema.safeParse({ ...placeholder, [field]: 'private' }).success).toBe(false);
  for (const counts of [
    { likes: -1, favorites: 0 },
    { likes: 1.1, favorites: 0 },
    { likes: 0, favorites: 0, liked: true },
  ])
    expect(InteractionCountsSchema.safeParse(counts).success).toBe(false);
});

it('收藏关键词拒绝PostgreSQL无法接收的空字符', () => {
  expect(FavoritesQuerySchema.safeParse({ q: '星\0光' }).success).toBe(false);
});
