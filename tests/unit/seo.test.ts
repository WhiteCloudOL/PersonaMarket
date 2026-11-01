import { afterEach, expect, it, vi } from 'vitest';
import { PublicSitemapQuerySchema, SITEMAP_MAX_PAGES } from '@personamarket/contracts';
import {
  siteOrigin,
  allowPublicIndexing,
  absolutePublicUrl,
  publicMetadata,
  sitemapIndexXml,
  sitemapEntriesXml,
  sitemapResponse,
  unavailableSitemap,
} from '../../apps/web/src/lib/seo.js';

afterEach(() => vi.unstubAllEnvs());
it('公开URL只使用受控origin，拒绝凭据、路径、伪协议和跨站地址', () => {
  const origin = siteOrigin('https://market.example.org');
  expect(origin?.href).toBe('https://market.example.org/');
  expect(absolutePublicUrl('/personas/abc', origin)).toBe(
    'https://market.example.org/personas/abc',
  );
  for (const value of [
    'https://market.example.org/?secret=x',
    'https://user:secret@market.example.org',
    'https://market.example.org/path',
    'javascript:alert(1)',
    'invalid',
  ])
    expect(siteOrigin(value)).toBeNull();
  for (const path of ['//evil.example', '/\\evil.example', 'https://evil.example'])
    expect(() => absolutePublicUrl(path, origin)).toThrow();
});
it('仅生产HTTPS域名可索引，本机、测试环境、IP和保留测试域名关闭索引', () => {
  expect(allowPublicIndexing(siteOrigin('https://market.example.org'), 'production')).toBe(true);
  for (const value of [
    'http://market.example.org',
    'https://127.0.0.1',
    'https://[::1]',
    'https://localhost',
    'https://market.test',
    'https://market.invalid',
    'https://market.local',
  ])
    expect(allowPublicIndexing(siteOrigin(value), 'production')).toBe(false);
  expect(allowPublicIndexing(siteOrigin('https://market.example.org'), 'test')).toBe(false);
  expect(allowPublicIndexing(null, 'production')).toBe(false);
});
it('公开详情元数据使用真实标题与图片，历史分享保持独立canonical并禁止索引', () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('PUBLIC_ORIGIN', 'https://market.example.org');
  const metadata = publicMetadata({
    path: '/personas/real/releases/frozen',
    title: '林间 <星光> · v1.0.0',
    description: '作者原本的简介。',
    noIndex: true,
    imagePath: '/api/v1/public/assets/owned',
    publishedTime: '2026-10-27T00:00:00Z',
  });
  expect(metadata.alternates?.canonical).toBe(
    'https://market.example.org/personas/real/releases/frozen',
  );
  expect(metadata.robots).toEqual({ index: false, follow: true });
  expect(metadata.title).toContain('林间 <星光>');
  expect(metadata.description).toBe('作者原本的简介。');
  expect(metadata.openGraph).toMatchObject({
    type: 'article',
    images: [{ url: 'https://market.example.org/api/v1/public/assets/owned' }],
  });
  expect(
    publicMetadata({ path: '/', title: '清蒸云鸭·人设市场', description: '公开介绍' }).robots,
  ).toEqual({ index: true, follow: true });
});
it('站点地图完整转义XML，使用真实修改时间且失败明确返回503/no-store', async () => {
  const xml = sitemapEntriesXml([
    { url: 'https://market.example.org/?a=1&b=<"x">', publishedAt: '2026-10-27T00:00:00Z' },
  ]);
  expect(xml).toContain('?a=1&amp;b=&lt;&quot;x&quot;&gt;');
  expect(xml).toContain('<lastmod>2026-10-27T00:00:00Z</lastmod>');
  expect(sitemapIndexXml(['https://market.example.org/a?b=1&c=2'])).toContain('b=1&amp;c=2');
  const success = sitemapResponse(xml);
  expect(success.headers.get('cache-control')).toBe('no-store');
  expect(success.headers.get('content-type')).toContain('application/xml');
  const failed = unavailableSitemap();
  expect(failed.status).toBe(503);
  expect(failed.headers.get('cache-control')).toBe('no-store');
  expect(await failed.text()).not.toContain('secret');
});
it('站点地图分片页码有界，为固定分片预留索引项', () => {
  expect(SITEMAP_MAX_PAGES + 1).toBe(50000);
  expect(PublicSitemapQuerySchema.parse({})).toEqual({ page: 1 });
  for (const page of ['0', '-1', '1.5', '50000', 'NaN'])
    expect(PublicSitemapQuerySchema.safeParse({ page }).success).toBe(false);
  expect(PublicSitemapQuerySchema.safeParse({ page: 1, q: 'private' }).success).toBe(false);
});
