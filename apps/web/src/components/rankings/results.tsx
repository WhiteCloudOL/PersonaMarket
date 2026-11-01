import Link from 'next/link';
import { Clock3Icon, SparklesIcon } from 'lucide-react';
import type { RankingQuery, RankingListResponse } from '@personamarket/contracts';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@personamarket/ui/components/card';
import { Alert, AlertTitle, AlertDescription } from '@personamarket/ui/components/alert';
import { Badge } from '@personamarket/ui/components/badge';
import { buttonVariants } from '@personamarket/ui/components/button';
import { cn } from '@personamarket/ui/lib/utils';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
} from '@personamarket/ui/components/empty';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { readPublicRankings } from '@/lib/public-rankings';
import { changeRankingFilters, rankingHref } from '@/lib/ranking-state';
import { PublicCardGrid } from '@/components/personas/public-cards';
import { InteractionProvider } from '@/components/personas/interaction-controls';
import { LatestRankingButton } from './latest-button';
import { RankingPagination } from './pagination';
import { RankingRules } from '../personas/ranking-rules';

function dateLabel(value: string | undefined, withTime = false) {
  if (!value) return '时间暂不可用';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(withTime ? ({ hour: '2-digit', minute: '2-digit' } as const) : {}),
  }).format(new Date(value));
}
function scoreLabel(
  item: RankingListResponse['data'][number],
  kind: RankingQuery['kind'],
  algorithm: RankingListResponse['meta']['algorithm'],
) {
  if (kind === 'hot')
    return (
      (algorithm === 'exports-v1' ? '导出热度 ' : '互动热度 ') +
      item.score.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
    );
  if (kind === 'likes') return '有效点赞 ' + item.eligibleLikes.toLocaleString('zh-CN');
  if (kind === 'favorites') return '有效收藏 ' + item.eligibleFavorites.toLocaleString('zh-CN');
  if (kind === 'downloads') return '有效导出 ' + item.eligibleExports.toLocaleString('zh-CN');
  if (kind === 'new') return '首次公开 ' + dateLabel(item.firstPublishedAt);
  return '版本更新 ' + dateLabel(item.publishedAt);
}

export function RankingLoading() {
  return (
    <section aria-label="榜单结果" aria-busy="true" className="flex min-w-0 flex-col gap-4">
      <p role="status" className="text-muted-foreground">
        正在读取榜单…
      </p>
      <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Card key={index}>
            <CardContent className="flex flex-col gap-4">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

export async function RankingResults({ query }: { query: RankingQuery }) {
  const result = await readPublicRankings(query);
  const latestHref = rankingHref(changeRankingFilters(query, {}));
  if (!result.ok) {
    const title =
      result.reason === 'expired'
        ? '这批榜单已过期'
        : result.reason === 'rate-limited'
          ? '读取请求较多，请稍后重试'
          : '暂时无法读取榜单';
    return (
      <Card role="alert">
        <CardHeader>
          <CardTitle>
            <h2>{title}</h2>
          </CardTitle>
          <CardDescription>
            {result.reason === 'expired'
              ? '载入最新榜单后，从第一页继续浏览'
              : '榜单可能正在准备或连接暂时中断，筛选条件已保留'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col items-start gap-4">
          <LatestRankingButton
            href={latestHref}
            label={result.reason === 'expired' ? '载入最新榜单' : '重试'}
          />
          {result.requestId && (
            <p className="break-all text-sm text-muted-foreground">请求编号 {result.requestId}</p>
          )}
        </CardContent>
      </Card>
    );
  }
  const { data, meta } = result.value;
  const paged = { ...query, snapshotId: meta.snapshotId };
  return (
    <section aria-label="榜单结果" className="flex min-w-0 flex-col gap-5">
      <h2 className="sr-only">榜单结果</h2>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p role="status" className="font-medium tabular-nums">
            本批 {meta.total.toLocaleString('zh-CN')} 个人设
            {meta.limited ? ' · 展示范围上限 ' + meta.entryLimit : ''}
          </p>
          <p className="break-words text-sm text-muted-foreground">
            更新于 <time dateTime={meta.generatedAt}>{dateLabel(meta.generatedAt, true)}</time> ·
            北京时间
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RankingRules meta={meta} />
          <LatestRankingButton href={latestHref} />
        </div>
      </div>
      {query.kind === 'hot' && meta.algorithm === 'exports-v1' && (
        <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline">旧版快照</Badge>
          本批热门仅按有效导出计分，点赞和收藏未计入
        </p>
      )}
      {meta.stale && (
        <Alert role="status">
          <Clock3Icon aria-hidden />
          <AlertTitle>这批榜单有一段时间未更新</AlertTitle>
          <AlertDescription>当前保留最近一次成功结果，可刷新查看新一批榜单</AlertDescription>
        </Alert>
      )}
      {data.length ? (
        <InteractionProvider ids={data.map((item) => item.personaId)}>
          <ol
            className={cn('grid min-w-0 gap-5', data.length > 1 && 'sm:grid-cols-2')}
            aria-label="人设排名"
          >
            {data.map((item) => (
              <li
                key={item.personaId}
                value={item.position}
                className="flex min-w-0 flex-col gap-2"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2 px-1">
                  <Badge
                    variant={item.position <= 3 ? 'default' : 'secondary'}
                    className="tabular-nums"
                  >
                    第 {item.position} 名
                  </Badge>
                  <span className="min-w-0 break-words text-sm tabular-nums text-muted-foreground">
                    {scoreLabel(item, query.kind, meta.algorithm)}
                  </span>
                  <span className="ml-auto text-sm tabular-nums text-muted-foreground">
                    v{item.version}
                  </span>
                </div>
                <PublicCardGrid
                  items={[item]}
                  layout={data.length === 1 ? 'compact' : 'list'}
                  className="flex-1"
                />
              </li>
            ))}
          </ol>
        </InteractionProvider>
      ) : (
        <Card>
          <CardContent>
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SparklesIcon aria-hidden />
                </EmptyMedia>
                <EmptyTitle className="text-base">还没有符合条件的人设</EmptyTitle>
                <EmptyDescription className="text-base">
                  试试其他榜单或平台，符合条件的公开作品会在下一次刷新时加入
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {query.page > 1 ? (
                  <Link
                    prefetch={false}
                    href={latestHref}
                    className={buttonVariants({ variant: 'outline' })}
                  >
                    回到第一页
                  </Link>
                ) : (
                  <Link href="/explore" className={buttonVariants({ variant: 'outline' })}>
                    探索人设
                  </Link>
                )}
              </EmptyContent>
            </Empty>
          </CardContent>
        </Card>
      )}
      <RankingPagination query={paged} total={meta.total} />
    </section>
  );
}
