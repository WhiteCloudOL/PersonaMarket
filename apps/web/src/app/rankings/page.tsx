import { Suspense } from 'react';
import Link from 'next/link';
import { canonicalJson, RankingQuerySchema } from '@personamarket/contracts';
import { PageContainer, PageIntro } from '@/components/page-layout';
import { RankingControls } from '@/components/rankings/controls';
import { RankingResults, RankingLoading } from '@/components/rankings/results';
import { parseRankingLocation, changeRankingFilters, rankingHref } from '@/lib/ranking-state';
import { pageMetadata } from '@/lib/public-seo';
import { Alert, AlertTitle, AlertDescription } from '@personamarket/ui/components/alert';
import { buttonVariants } from '@personamarket/ui/components/button';

export const dynamic = 'force-dynamic';
type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
export async function generateMetadata({ searchParams }: Props) {
  const parsed = parseRankingLocation(await searchParams);
  const canonical = parsed.success
    ? rankingHref(changeRankingFilters(parsed.data, {}))
    : '/rankings';
  return pageMetadata(
    canonical,
    '人设排行榜',
    '按真实有效互动、导出、新作与版本更新发现 MaiBot 和 AstrBot 公开人设，支持平台和适用时间范围',
    !parsed.success || parsed.data.page > 1 || Boolean(parsed.data.snapshotId),
  );
}
export default async function Page({ searchParams }: Props) {
  const parsed = parseRankingLocation(await searchParams);
  const query = parsed.success ? parsed.data : RankingQuerySchema.parse({});
  return (
    <PageContainer>
      <PageIntro
        eyebrow="每一份创作，都值得被看见"
        title={
          <>
            人设<span className="text-primary">排行榜</span>
          </>
        }
        description="从最新的灵感到热门的相遇，发现 MaiBot 与 AstrBot 公开人设"
      />
      <RankingControls initial={query} />
      {parsed.success ? (
        <Suspense key={canonicalJson(query)} fallback={<RankingLoading />}>
          <RankingResults query={query} />
        </Suspense>
      ) : (
        <Alert>
          <AlertTitle>筛选地址格式不正确</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <p>请重新选择榜单，或清空当前网址中的筛选条件</p>
            <Link href="/rankings" className={buttonVariants({ variant: 'outline' })}>
              清空条件
            </Link>
          </AlertDescription>
        </Alert>
      )}
    </PageContainer>
  );
}
