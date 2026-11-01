import { readSitemapIndex } from '@/lib/public-seo';
import { absolutePublicUrl, sitemapIndexXml, sitemapResponse, unavailableSitemap } from '@/lib/seo';

export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const index = await readSitemapIndex();
    const urls = [
      absolutePublicUrl('/sitemaps/static.xml'),
      ...Array.from({ length: index.pages }, (_, page) =>
        absolutePublicUrl('/sitemaps/personas/' + (page + 1) + '.xml'),
      ),
    ];
    return sitemapResponse(sitemapIndexXml(urls));
  } catch {
    return unavailableSitemap();
  }
}
