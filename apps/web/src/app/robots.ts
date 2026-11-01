import type { MetadataRoute } from 'next';
import { absolutePublicUrl, allowPublicIndexing, siteOrigin } from '@/lib/seo';

export const dynamic = 'force-dynamic';
export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin();
  if (!allowPublicIndexing(origin)) return { rules: { userAgent: '*', disallow: '/' } };
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/admin',
        '/dashboard',
        '/account',
        '/login',
        '/register',
        '/mfa',
        '/forgot-password',
        '/reset-password',
        '/verify-email',
        '/change-email',
      ],
    },
    sitemap: absolutePublicUrl('/sitemap.xml', origin),
  };
}
