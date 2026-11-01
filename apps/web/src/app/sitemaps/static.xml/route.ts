import {
  absolutePublicUrl,
  sitemapEntriesXml,
  sitemapResponse,
  unavailableSitemap,
} from '@/lib/seo';
import { readAnnouncementSitemap } from '@/lib/public-announcements';
import { readGuideSitemap } from '@/lib/public-guides';
import { readPublicPolicies } from '@/lib/policies';

export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const [announcements, guides, policies] = await Promise.all([
      readAnnouncementSitemap(),
      readGuideSitemap(),
      readPublicPolicies(),
    ]);
    return sitemapResponse(
      sitemapEntriesXml([
        ...['/', '/explore', '/rankings', '/guides', '/announcements'].map((path) => ({
          url: absolutePublicUrl(path),
        })),
        ...announcements.map((item) => ({
          url: absolutePublicUrl('/announcements/' + item.id),
          publishedAt: item.publishedAt,
        })),
        ...guides.map((item) => ({
          url: absolutePublicUrl('/guides/' + item.slug),
          publishedAt: item.publishedAt,
        })),
        ...policies.map((item) => ({
          url: absolutePublicUrl('/' + item.slug),
          publishedAt: item.activatedAt,
        })),
      ]),
    );
  } catch {
    return unavailableSitemap();
  }
}
