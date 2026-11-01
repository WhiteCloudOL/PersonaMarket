import { expect, it } from 'vitest';
import { RankingQuerySchema } from '@personamarket/contracts';
import {
  parseRankingLocation,
  rankingHref,
  changeRankingFilters,
} from '../../apps/web/src/lib/ranking-state.js';
import { trustedPublicHeaders } from '../../apps/web/src/lib/trusted-public-headers.js';

it('分享地址还原适用范围、平台、同批次分页，裸榜单名使用该榜的默认范围', () => {
  const query = RankingQuerySchema.parse({
    kind: 'downloads',
    window: 'all',
    platform: 'astrbot',
    page: 2,
    snapshotId: '10000000-0000-4000-8000-000000000001',
  });
  const url = new URL(rankingHref(query), 'https://fixture.invalid');
  expect(parseRankingLocation(Object.fromEntries(url.searchParams))).toMatchObject({
    success: true,
    data: query,
  });
  expect(parseRankingLocation({ kind: 'new' })).toMatchObject({
    success: true,
    data: { kind: 'new', window: '30d' },
  });
  expect(parseRankingLocation({ kind: 'updated' })).toMatchObject({
    success: true,
    data: { window: 'all' },
  });
  expect(rankingHref(RankingQuerySchema.parse({}))).toBe('/rankings');
  for (const params of [
    { kind: 'hot', window: 'all' },
    { page: '51' },
    { kind: ['new', 'hot'] },
    { snapshotId: 'private' },
  ])
    expect(parseRankingLocation(params).success).toBe(false);
});

it('切换榜单或筛选清除旧批次和页码，保留仍适用的范围', () => {
  const current = RankingQuerySchema.parse({
    kind: 'downloads',
    window: 'all',
    page: 50,
    snapshotId: '10000000-0000-4000-8000-000000000001',
  });
  expect(changeRankingFilters(current, { kind: 'hot' })).toMatchObject({
    kind: 'hot',
    window: '7d',
    page: 1,
    snapshotId: undefined,
  });
  expect(changeRankingFilters(current, { platform: 'astrbot' })).toMatchObject({
    kind: 'downloads',
    window: 'all',
    platform: 'astrbot',
    page: 1,
    snapshotId: undefined,
  });
  expect(changeRankingFilters(current, { kind: 'updated' }).window).toBe('all');
});

it('旧新作分享地址继续30天，运营窗口显式编码，点击新作使用运营范围', () => {
  const snapshotId = '10000000-0000-4000-8000-000000000001';
  expect(parseRankingLocation({ kind: 'new', snapshotId })).toMatchObject({
    success: true,
    data: { window: '30d', snapshotId },
  });
  expect(rankingHref(RankingQuerySchema.parse({ kind: 'new', window: '30d', snapshotId }))).toBe(
    '/rankings?kind=new&snapshotId=' + snapshotId,
  );
  const next = changeRankingFilters(RankingQuerySchema.parse({}), { kind: 'new' });
  expect(next.window).toBe('newcomer');
  expect(rankingHref(next)).toBe('/rankings?kind=new&window=newcomer');
  expect(parseRankingLocation({ kind: 'new', window: 'newcomer' })).toMatchObject({
    success: true,
    data: { window: 'newcomer' },
  });
});
it('SSR仅在显式受信代理下转发一个合法IP，拒绝链、头注入、主机名和隐式开启', () => {
  expect(trustedPublicHeaders('1', '203.0.113.8')).toEqual({ 'x-forwarded-for': '203.0.113.8' });
  expect(trustedPublicHeaders('1', '2001:db8::8')).toEqual({ 'x-forwarded-for': '2001:db8::8' });
  for (const flag of [undefined, '0', 1, true])
    expect(trustedPublicHeaders(flag, '203.0.113.8')).toEqual({});
  for (const value of [
    null,
    [],
    'example.com',
    '203.0.113.8, 198.51.100.1',
    '203.0.113.8\r\nCookie: session=private',
    'http://127.0.0.1',
    '203.0.113.8:80',
  ])
    expect(trustedPublicHeaders('1', value)).toEqual({});
});
