import { pageMetadata } from '@/lib/public-seo';
import { HomeHero } from '@/components/home-hero';
import { HomeFeatured } from '@/components/home/featured';
import { HomeAnnouncements } from '@/components/home/announcements';
import { HomeRecent, HomeCreation } from '@/components/home/sections';
import { readAnnouncements } from '@/lib/public-announcements';
import { PlatformSchema, PublicAnnouncementsQuerySchema } from '@personamarket/contracts';
import { readPublicBrand } from '@/lib/site-data';
import { readSiteHome } from '@/lib/public-home';
import { readPublicPersonas, readPublicStatistics } from '@/lib/public-personas';
import { PageContainer } from '@/components/page-layout';
import { Alert, AlertTitle, AlertDescription } from '@personamarket/ui/components/alert';
import { ReloadButton } from '@/components/reload-button';
export const dynamic = 'force-dynamic';
export function generateMetadata() {
  return pageMetadata('/');
}
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const brandRequest = readPublicBrand(),
    statisticsRequest = readPublicStatistics();
  const [config, query] = await Promise.all([readSiteHome(), searchParams]);
  const parsedPlatform = PlatformSchema.safeParse(query['recentPlatform']);
  const platform = parsedPlatform.success ? parsedPlatform.data : undefined;
  const enabled = new Set(
    config?.data.sections.filter((section) => section.enabled).map((section) => section.key),
  );
  const [brand, statistics, featured, recent, announcements] = await Promise.all([
    brandRequest,
    statisticsRequest,
    config && enabled.has('featured')
      ? readPublicPersonas({ featured: 'true', pageSize: config.data.featuredCount })
      : null,
    config && enabled.has('recent')
      ? readPublicPersonas({ pageSize: config.data.recentCount, ...(platform ? { platform } : {}) })
      : null,
    config && enabled.has('announcements')
      ? readAnnouncements(
          PublicAnnouncementsQuerySchema.parse({ pageSize: config.data.announcementCount }),
        )
      : null,
  ]);
  return (
    <PageContainer className="lg:gap-5 lg:pt-4">
      <HomeHero
        initialData={brand}
        statistics={statistics}
        homeNote={config?.data.heroNote ?? null}
      />
      {!config && (
        <Alert>
          <AlertTitle>首页展示设置暂时不可用</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <p>重新加载后再核对可展示内容</p>
            <ReloadButton />
          </AlertDescription>
        </Alert>
      )}
      {config?.data.sections.map((section) => {
        if (!section.enabled) return null;
        switch (section.key) {
          case 'featured':
            return <HomeFeatured key={section.key} items={featured?.data ?? null} />;
          case 'recent':
            return (
              <HomeRecent key={section.key} items={recent?.data ?? null} platform={platform} />
            );
          case 'announcements':
            return <HomeAnnouncements key={section.key} items={announcements?.data ?? null} />;
          case 'creation':
            return <HomeCreation key={section.key} />;
        }
      })}
    </PageContainer>
  );
}
