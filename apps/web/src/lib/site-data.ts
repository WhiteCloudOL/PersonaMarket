import { cache } from 'react';
import { fetchPublicConfig } from '@personamarket/api-client';
export const readPublicBrand = cache(() =>
  fetchPublicConfig(process.env['API_INTERNAL_ORIGIN'] ?? 'http://127.0.0.1:3001').catch(
    () => null,
  ),
);
