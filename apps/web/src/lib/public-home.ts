import { cache } from 'react';
import { headers } from 'next/headers';
import { getPublicHomeSettings } from '@personamarket/api-client';
import { PublicHomeSettingsResponseSchema } from '@personamarket/contracts';
import { trustedPublicHeaders } from './trusted-public-headers';

export const readSiteHome = cache(async () => {
  try {
    const response = await getPublicHomeSettings({
      baseUrl: process.env['API_INTERNAL_ORIGIN'] ?? 'http://127.0.0.1:3001',
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
      headers:
        process.env['TRUST_PROXY_HOPS'] === '1'
          ? trustedPublicHeaders('1', (await headers()).get('x-forwarded-for'))
          : {},
    });
    return response.response.ok ? PublicHomeSettingsResponseSchema.parse(response.data) : null;
  } catch {
    return null;
  }
});
