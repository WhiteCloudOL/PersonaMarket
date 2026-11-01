import { cache } from 'react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getPublicGuides, getPublicGuide, getGuideSitemap } from '@personamarket/api-client';
import {
  GuideSlugSchema,
  PublicGuideResponseSchema,
  PublicGuidesResponseSchema,
  GuideSitemapResponseSchema,
} from '@personamarket/contracts';
import { trustedPublicHeaders } from './trusted-public-headers';
import { publicMetadata, defaultBrand } from './seo';
import { readPublicBrand } from './site-data';

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
export const readPublicGuides = cache(async () => {
  try {
    const result = await getPublicGuides(await options());
    return result.response.ok ? PublicGuidesResponseSchema.parse(result.data) : null;
  } catch {
    return null;
  }
});
// 只在当前服务端渲染中共享，新的访问始终重查公开状态
export const readPublicGuide = cache(async (slug: string) => {
  const parsed = GuideSlugSchema.safeParse(slug);
  if (!parsed.success) notFound();
  const result = await getPublicGuide({
    ...(await options()),
    params: { path: { slug: parsed.data } },
  });
  if ([400, 404].includes(result.response.status)) notFound();
  if (!result.response.ok) throw new Error('指南暂时无法读取，请稍后重试');
  return PublicGuideResponseSchema.parse(result.data).data;
});
export async function guideMetadata(slug: string) {
  const [item, brand] = await Promise.all([readPublicGuide(slug), readPublicBrand()]);
  return publicMetadata({
    path: '/guides/' + item.slug,
    title: item.title,
    description: item.summary || item.title,
    brand: brand?.data ?? defaultBrand,
    publishedTime: item.publishedAt,
  });
}
export async function readGuideSitemap() {
  const result = await getGuideSitemap(await options());
  if (!result.response.ok) throw new Error('指南站点地图暂时无法读取');
  return GuideSitemapResponseSchema.parse(result.data).data;
}
