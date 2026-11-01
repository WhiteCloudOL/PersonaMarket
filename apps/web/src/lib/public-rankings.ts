import { headers } from 'next/headers';
import { listPublicRankings } from '@personamarket/api-client';
import {
  RankingListResponseSchema,
  type RankingQuery,
  type RankingListResponse,
} from '@personamarket/contracts';
import { trustedPublicHeaders } from './trusted-public-headers';

type RankingRead =
  | { ok: true; value: RankingListResponse }
  | { ok: false; reason: 'expired' | 'unavailable' | 'rate-limited'; requestId?: string };

export async function readPublicRankings(query: RankingQuery): Promise<RankingRead> {
  try {
    const forwarded =
      process.env['TRUST_PROXY_HOPS'] === '1'
        ? trustedPublicHeaders('1', (await headers()).get('x-forwarded-for'))
        : {};
    const result = await listPublicRankings({
      baseUrl: process.env['API_INTERNAL_ORIGIN'] ?? 'http://127.0.0.1:3001',
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
      headers: forwarded,
      params: {
        query: {
          kind: query.kind,
          window: query.window,
          platform: query.platform,
          page: query.page,
          pageSize: query.pageSize,
          ...(query.snapshotId ? { snapshotId: query.snapshotId } : {}),
        },
      },
    });
    if (!result.response.ok) {
      const requestId = result.response.headers.get('x-request-id');
      return {
        ok: false,
        reason:
          result.response.status === 404
            ? 'expired'
            : result.response.status === 429
              ? 'rate-limited'
              : 'unavailable',
        ...(requestId ? { requestId } : {}),
      };
    }
    return { ok: true, value: RankingListResponseSchema.parse(result.data) };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
