import { cache } from 'react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import {
  listPublicAnnouncements,
  getPublicAnnouncement,
  getAnnouncementSitemap,
} from '@personamarket/api-client';
import {
  IdSchema,
  PublicAnnouncementResponseSchema,
  PublicAnnouncementsResponseSchema,
  AnnouncementSitemapResponseSchema,
  type PublicAnnouncementsQuery,
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
export async function readAnnouncements(input: PublicAnnouncementsQuery) {
  try {
    const result = await listPublicAnnouncements({
      ...(await options()),
      params: { query: input },
    });
    return result.response.ok ? PublicAnnouncementsResponseSchema.parse(result.data) : null;
  } catch {
    return null;
  }
}
// 元数据和正文只在同一次服务端渲染内共享，撤回后的新请求始终重查公开资格
export const readAnnouncement = cache(async (id: string) => {
  if (!IdSchema.safeParse(id).success) notFound();
  const result = await getPublicAnnouncement({
    ...(await options()),
    params: { path: { id: id.toLowerCase() } },
  });
  if ([400, 404].includes(result.response.status)) notFound();
  if (!result.response.ok) throw new Error('公告暂时无法读取，请稍后重试');
  return PublicAnnouncementResponseSchema.parse(result.data).data;
});
export async function announcementMetadata(id: string) {
  const [item, config] = await Promise.all([readAnnouncement(id), readPublicBrand()]);
  return publicMetadata({
    path: '/announcements/' + item.id,
    title: item.title,
    description: item.summary || Array.from(item.body).slice(0, 160).join(''),
    brand: config?.data ?? defaultBrand,
    publishedTime: item.publishedAt,
  });
}
export async function readAnnouncementSitemap() {
  const result = await getAnnouncementSitemap(await options());
  if (!result.response.ok) throw new Error('公告站点地图暂时无法读取');
  return AnnouncementSitemapResponseSchema.parse(result.data).data;
}
