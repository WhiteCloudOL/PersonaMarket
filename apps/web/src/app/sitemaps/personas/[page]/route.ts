import { PublicSitemapQuerySchema } from '@personamarket/contracts';
import { readSitemapEntries } from '@/lib/public-seo';
import {
  absolutePublicUrl,
  sitemapEntriesXml,
  sitemapResponse,
  unavailableSitemap,
} from '@/lib/seo';

export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: { params: Promise<{ page: string }> }) {
  const segment = (await params).page;
  const parsed = PublicSitemapQuerySchema.safeParse({
    page: /^([1-9]\d{0,4})\.xml$/.exec(segment)?.[1] ?? 0,
  });
  if (!parsed.success)
    return new Response('站点地图不存在', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  try {
    const entries = await readSitemapEntries(parsed.data.page);
    return sitemapResponse(
      sitemapEntriesXml(
        entries.map((entry) => ({
          url: absolutePublicUrl('/personas/' + entry.personaId),
          publishedAt: entry.publishedAt,
        })),
      ),
    );
  } catch {
    return unavailableSitemap();
  }
}
