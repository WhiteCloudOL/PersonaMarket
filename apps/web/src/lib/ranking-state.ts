import {
  RankingKindSchema,
  RankingQuerySchema,
  rankingWindows,
  type RankingQuery,
} from '@personamarket/contracts';

export function parseRankingLocation(params: Record<string, string | string[] | undefined>) {
  const kind = RankingKindSchema.safeParse(params['kind'] ?? 'hot');
  return RankingQuerySchema.safeParse({
    kind: params['kind'] ?? 'hot',
    window: params['window'] ?? (kind.success ? rankingWindows[kind.data][0] : '7d'),
    platform: params['platform'] ?? 'all',
    page: params['page'] ?? 1,
    pageSize: 20,
    snapshotId: params['snapshotId'],
  });
}

export function changeRankingFilters(
  current: RankingQuery,
  patch: Partial<Pick<RankingQuery, 'kind' | 'window' | 'platform'>>,
): RankingQuery {
  const kind = patch.kind ?? current.kind;
  const preferredWindow =
    patch.window ?? (patch.kind === 'new' && current.kind !== 'new' ? 'newcomer' : current.window);
  const window = rankingWindows[kind].includes(preferredWindow)
    ? preferredWindow
    : (rankingWindows[kind][0] ?? '7d');
  return RankingQuerySchema.parse({
    ...current,
    ...patch,
    kind,
    window,
    page: 1,
    snapshotId: undefined,
  });
}

export function rankingHref(query: RankingQuery) {
  const params = new URLSearchParams();
  if (query.kind !== 'hot') params.set('kind', query.kind);
  if (query.window !== rankingWindows[query.kind][0]) params.set('window', query.window);
  if (query.platform !== 'all') params.set('platform', query.platform);
  if (query.page > 1) params.set('page', String(query.page));
  if (query.snapshotId) params.set('snapshotId', query.snapshotId);
  const search = params.toString();
  return '/rankings' + (search ? '?' + search : '');
}
