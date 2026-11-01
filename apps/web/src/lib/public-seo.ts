import { headers } from 'next/headers';
import { getPublicSitemapIndex, getPublicSitemapEntries } from '@personamarket/api-client';
import {
  PublicSitemapIndexResponseSchema,
  PublicSitemapEntriesResponseSchema,
} from '@personamarket/contracts';
import { trustedPublicHeaders } from './trusted-public-headers';
import { publicMetadata, defaultBrand } from './seo';
import { readPublicBrand } from './site-data';
import { readPublicPersona } from './public-personas';

export async function pageMetadata(
  path: string,
  title?: string,
  description?: string,
  noIndex = false,
) {
  const brand = (await readPublicBrand())?.data ?? defaultBrand;
  return publicMetadata({
    path,
    title: title ?? brand.name,
    description: description ?? brand.description,
    brand,
    noIndex,
  });
}
export async function personaMetadata(id: string, releaseId?: string) {
  const [item, config] = await Promise.all([readPublicPersona(id, releaseId), readPublicBrand()]);
  const brand = config?.data ?? defaultBrand;
  const path = '/personas/' + item.personaId + (releaseId ? '/releases/' + item.releaseId : '');
  const imageId = item.snapshot.coverAssetId ?? item.snapshot.avatarAssetId;
  return publicMetadata({
    path,
    title: item.snapshot.title + (releaseId ? ' · v' + item.version : ''),
    description: item.snapshot.summary,
    brand,
    ...(imageId ? { imagePath: '/api/v1/public/assets/' + imageId } : {}),
    noIndex: Boolean(releaseId),
    publishedTime: item.publishedAt,
  });
}
async function options() {
  return {
    baseUrl: process.env['API_INTERNAL_ORIGIN'] ?? 'http://127.0.0.1:3001',
    cache: 'no-store' as const,
    signal: AbortSignal.timeout(8000),
    headers:
      process.env['TRUST_PROXY_HOPS'] === '1'
        ? trustedPublicHeaders('1', (await headers()).get('x-forwarded-for'))
        : {},
  };
}
export async function readSitemapIndex() {
  const result = await getPublicSitemapIndex(await options());
  if (!result.response.ok) throw new Error('暂时无法读取站点地图');
  return PublicSitemapIndexResponseSchema.parse(result.data).data;
}
export async function readSitemapEntries(page: number) {
  const result = await getPublicSitemapEntries({
    ...(await options()),
    params: { query: { page } },
  });
  if (!result.response.ok) throw new Error('暂时无法读取站点地图');
  return PublicSitemapEntriesResponseSchema.parse(result.data).data;
}
