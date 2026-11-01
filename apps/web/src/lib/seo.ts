import type { Metadata } from 'next';
import type { PublicBrand } from '@personamarket/contracts';
import { isIP } from 'node:net';

export const defaultBrand: PublicBrand = {
  name: '清蒸云鸭·人设市场',
  description: '创作、分享与发现 MaiBot 和 AstrBot 人设',
  defaultLocale: 'zh-CN',
};

export function siteOrigin(value = process.env['PUBLIC_ORIGIN']): URL | null {
  if (!value) return null;
  try {
    const origin = new URL(value);
    if (
      !['http:', 'https:'].includes(origin.protocol) ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash
    )
      return null;
    return origin;
  } catch {
    return null;
  }
}
export function allowPublicIndexing(origin: URL | null, runtime = process.env['NODE_ENV']) {
  if (!origin || runtime !== 'production' || origin.protocol !== 'https:') return false;
  const hostname = origin.hostname.toLowerCase().replace(/\.$/, '');
  return (
    hostname.includes('.') &&
    !hostname.startsWith('[') &&
    !isIP(hostname) &&
    !/(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(hostname)
  );
}
export function absolutePublicUrl(path: string, origin = siteOrigin()) {
  if (!origin || !path.startsWith('/') || path.startsWith('//'))
    throw new Error('站点公开地址配置无效');
  const target = new URL(path, origin);
  if (target.origin !== origin.origin) throw new Error('公开地址必须属于本站');
  return target.href;
}
type PublicMetadataInput = {
  path: string;
  title: string;
  description: string;
  brand?: PublicBrand;
  imagePath?: string;
  noIndex?: boolean;
  publishedTime?: string;
};
export function publicMetadata(input: PublicMetadataInput): Metadata {
  const origin = siteOrigin();
  const brand = input.brand ?? defaultBrand;
  const title = input.title === brand.name ? brand.name : input.title + ' · ' + brand.name;
  const url = origin ? absolutePublicUrl(input.path, origin) : undefined;
  const image = origin
    ? absolutePublicUrl(input.imagePath ?? '/images/anime-home-panorama.png', origin)
    : undefined;
  return {
    title,
    description: input.description,
    ...(url ? { alternates: { canonical: url } } : {}),
    robots: {
      index: allowPublicIndexing(origin) && !input.noIndex,
      follow: allowPublicIndexing(origin),
    },
    openGraph: {
      type: input.publishedTime ? 'article' : 'website',
      title,
      description: input.description,
      siteName: brand.name,
      locale: 'zh_CN',
      ...(url ? { url } : {}),
      ...(image ? { images: [{ url: image, alt: input.title }] } : {}),
      ...(input.publishedTime ? { publishedTime: input.publishedTime } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: input.description,
      ...(image ? { images: [image] } : {}),
    },
  };
}
function xml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character] ?? '',
  );
}
export function sitemapIndexXml(urls: string[]) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    urls.map((url) => '<sitemap><loc>' + xml(url) + '</loc></sitemap>').join('') +
    '</sitemapindex>\n'
  );
}
export function sitemapEntriesXml(entries: Array<{ url: string; publishedAt?: string }>) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    entries
      .map(
        (entry) =>
          '<url><loc>' +
          xml(entry.url) +
          '</loc>' +
          (entry.publishedAt ? '<lastmod>' + xml(entry.publishedAt) + '</lastmod>' : '') +
          '</url>',
      )
      .join('') +
    '</urlset>\n'
  );
}
export function sitemapResponse(body: string) {
  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
export function unavailableSitemap() {
  return new Response('站点地图暂时不可用，请稍后重试', {
    status: 503,
    headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' },
  });
}
