import { cache } from 'react';
import { headers } from 'next/headers';
import { getPublicSystemStatus } from '@personamarket/api-client';
import { PublicSystemStatusResponseSchema } from '@personamarket/contracts';
import { trustedPublicHeaders } from './trusted-public-headers';

export const readPublicSystemStatus = cache(async () => {
  const result = await getPublicSystemStatus({
    baseUrl: process.env['API_INTERNAL_ORIGIN'] ?? 'http://127.0.0.1:3001',
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
    headers:
      process.env['TRUST_PROXY_HOPS'] === '1'
        ? trustedPublicHeaders('1', (await headers()).get('x-forwarded-for'))
        : {},
  });
  if (!result.response.ok || result.error) throw new Error('维护状态暂时无法读取');
  return PublicSystemStatusResponseSchema.parse(result.data);
});
