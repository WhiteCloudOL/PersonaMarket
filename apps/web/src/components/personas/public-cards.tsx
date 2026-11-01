import Link from 'next/link';
import Image from 'next/image';
import { SparklesIcon, ArrowUpRightIcon, UserRoundIcon, DownloadIcon } from 'lucide-react';
import { cn } from '@personamarket/ui/lib/utils';
import type { PublicPersonaCard } from '@personamarket/contracts';
import { Badge } from '@personamarket/ui/components/badge';
import { PersonaCurationBadges } from './curation-badges';
import { InteractionControls, InteractionProvider } from './interaction-controls';
import {
  Card,
  CardHeader,
  CardContent,
  CardTitle,
  CardDescription,
} from '@personamarket/ui/components/card';
function ExportMetric({ item }: { item: PublicPersonaCard }) {
  const metric = item.exportMetric;
  if (item.interactionMetric)
    return (
      <Badge variant="secondary" className="h-auto max-w-full whitespace-normal py-1 tabular-nums">
        {item.interactionMetric.kind === 'likes' ? '有效点赞' : '有效收藏'}{' '}
        {item.interactionMetric.eligibleCount.toLocaleString('zh-CN')}
      </Badge>
    );
  if (item.heatMetric?.algorithm === 'interactions-v1') {
    const heat = item.heatMetric;
    return (
      <div className="flex min-w-0 flex-col items-start gap-1">
        <Badge
          variant="secondary"
          className="h-auto max-w-full whitespace-normal py-1 tabular-nums"
        >
          <SparklesIcon aria-hidden data-icon="inline-start" />
          互动热度 {heat.score.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}
        </Badge>
        <p className="break-words text-xs tabular-nums text-muted-foreground">
          有效点赞 {heat.eligibleLikes.toLocaleString('zh-CN')} · 收藏{' '}
          {heat.eligibleFavorites.toLocaleString('zh-CN')} · 导出{' '}
          {heat.eligibleExports.toLocaleString('zh-CN')}
        </p>
      </div>
    );
  }
  if (!metric && !item.heatMetric) return null;
  return (
    <Badge variant="secondary" className="h-auto max-w-full whitespace-normal py-1 tabular-nums">
      <DownloadIcon aria-hidden data-icon="inline-start" />
      {item.heatMetric ? (
        <>
          近期热度 {item.heatMetric.score.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} ·
          有效导出 {item.heatMetric.eligibleExports.toLocaleString('zh-CN')}
        </>
      ) : (
        metric && (
          <>
            {metric.window === '7d' ? '近7天有效导出' : '累计有效导出'}{' '}
            {metric.eligibleExports.toLocaleString('zh-CN')}
          </>
        )
      )}
    </Badge>
  );
}
export function PublicCards({
  items,
  layout = 'cover',
  maxColumns = 4,
  className,
}: {
  items: PublicPersonaCard[];
  layout?: 'compact' | 'cover' | 'list';
  maxColumns?: 2 | 4;
  className?: string;
}) {
  return (
    <InteractionProvider ids={items.map((item) => item.personaId)}>
      <PublicCardGrid
        items={items}
        layout={layout}
        maxColumns={maxColumns}
        {...(className ? { className } : {})}
      />
    </InteractionProvider>
  );
}
export function PublicCardGrid({
  items,
  layout = 'cover',
  maxColumns = 4,
  className,
}: {
  items: PublicPersonaCard[];
  layout?: 'compact' | 'cover' | 'list';
  maxColumns?: 2 | 4;
  className?: string;
}) {
  const count = Math.max(1, items.length);
  // 根据实际作品数均衡桌面行数，例如六条采用两行三列，单条和双条不预留空列
  const columns = layout === 'compact' ? Math.ceil(count / Math.ceil(count / maxColumns)) : 1;
  const single = layout === 'compact' && items.length === 1;
  if (layout !== 'cover')
    return (
      <div className="@container/persona-cards min-w-0">
        <div
          className={cn(
            'grid grid-cols-1 gap-3',
            columns > 1 && '@min-[38rem]/persona-cards:grid-cols-2',
            columns === 3 && '@min-[64rem]/persona-cards:grid-cols-3',
            columns === 4 && '@min-[64rem]/persona-cards:grid-cols-4',
            className,
          )}
        >
          {items.map((item) => (
            <article
              key={item.personaId}
              className="@container block min-w-0 rounded-xl outline-offset-4"
            >
              <Card
                className={cn(
                  'h-full flex-col gap-3 rounded-xl p-3 shadow-none transition-shadow hover:shadow-sm',
                  single && '@min-[36rem]:flex-row @min-[36rem]:items-center',
                )}
              >
                <Link
                  href={'/personas/' + item.personaId}
                  className="flex min-w-0 flex-1 flex-col gap-3 rounded-lg outline-offset-4 @min-[18rem]:flex-row"
                >
                  <div
                    className={cn(
                      'relative flex aspect-[4/3] w-full shrink-0 items-center justify-center overflow-hidden rounded-lg bg-accent @min-[18rem]:h-36 @min-[18rem]:w-24',
                      single && '@min-[36rem]:h-44 @min-[36rem]:w-1/3 @min-[36rem]:max-w-72',
                    )}
                  >
                    {item.snapshot.avatarAssetId || item.snapshot.coverAssetId ? (
                      <Image
                        src={
                          '/api/v1/public/assets/' +
                          (item.snapshot.avatarAssetId ?? item.snapshot.coverAssetId)
                        }
                        alt=""
                        fill
                        unoptimized
                        sizes={single ? '(min-width: 768px) 288px, 96px' : '96px'}
                        className="object-cover"
                      />
                    ) : (
                      <SparklesIcon className="size-9 text-primary/50" aria-hidden />
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-3">
                    <CardHeader className="min-w-0 gap-2 p-0">
                      <PersonaCurationBadges curation={item.curation} />
                      <Badge variant="secondary" className="w-fit max-w-full">
                        {item.snapshot.platform === 'maibot' ? 'MaiBot' : 'AstrBot'}
                      </Badge>
                      <CardTitle className="min-w-0 text-base [overflow-wrap:anywhere]">
                        {item.snapshot.title}
                      </CardTitle>
                      <CardDescription className="min-w-0 line-clamp-3 text-base leading-6 [overflow-wrap:anywhere]">
                        {item.snapshot.summary}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="mt-auto p-0">
                      <ExportMetric item={item} />
                      <p className="break-all text-sm text-muted-foreground">
                        {item.publication.publisher}
                      </p>
                    </CardContent>
                  </div>
                </Link>
                <CardContent
                  className={cn('p-0', single && '@min-[36rem]:w-48 @min-[36rem]:shrink-0')}
                >
                  <InteractionControls personaId={item.personaId} counts={item.interactionCounts} />
                </CardContent>
              </Card>
            </article>
          ))}
        </div>
      </div>
    );
  return (
    <div className={cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-4', className)}>
      {items.map((item) => (
        <article key={item.personaId} className="group block rounded-2xl outline-offset-4">
          <Card className="h-full gap-3 overflow-hidden p-2 transition-shadow [--card-spacing:--spacing(3)] hover:shadow-md">
            <Link
              href={'/personas/' + item.personaId}
              className="flex min-w-0 flex-1 flex-col gap-3 rounded-xl outline-offset-4"
            >
              <div className="relative flex h-36 items-center justify-center overflow-hidden rounded-xl bg-accent">
                {item.snapshot.coverAssetId || item.snapshot.avatarAssetId ? (
                  <Image
                    src={
                      '/api/v1/public/assets/' +
                      (item.snapshot.coverAssetId ?? item.snapshot.avatarAssetId)
                    }
                    alt=""
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw"
                    unoptimized
                    className="object-cover"
                  />
                ) : (
                  <SparklesIcon className="size-12 text-primary/35" aria-hidden />
                )}
                <Badge
                  variant="secondary"
                  className="absolute top-2 left-2 bg-card text-card-foreground shadow-sm"
                >
                  {item.snapshot.platform === 'maibot' ? 'MaiBot' : 'AstrBot'}
                </Badge>
              </div>
              <CardHeader className="gap-2 px-2">
                <PersonaCurationBadges curation={item.curation} />
                <CardTitle className="flex min-w-0 items-start justify-between gap-2 text-base">
                  <span className="min-w-0 [overflow-wrap:anywhere]">{item.snapshot.title}</span>
                  <ArrowUpRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </CardTitle>
                <CardDescription className="line-clamp-2 text-base leading-6 [overflow-wrap:anywhere]">
                  {item.snapshot.summary}
                </CardDescription>
                <div className="flex min-w-0 flex-wrap gap-1.5" aria-label="作品标签">
                  <Badge variant="secondary" className="h-auto whitespace-normal break-all py-1">
                    {item.publication.category.name}
                  </Badge>
                  {item.publication.tags.slice(0, 3).map((tag) => (
                    <Badge
                      key={tag.id}
                      variant="secondary"
                      className="h-auto whitespace-normal break-all py-1"
                    >
                      {tag.name}
                    </Badge>
                  ))}
                  <Badge variant="outline">
                    {item.snapshot.origin.type === 'original' ? '原创' : '转载'}
                  </Badge>
                </div>
                <ExportMetric item={item} />
              </CardHeader>
              <CardContent className="mt-auto flex min-w-0 items-start justify-between gap-2 border-t px-2 pt-3 pb-2">
                <span className="flex min-w-0 items-start gap-2 text-sm text-muted-foreground">
                  <UserRoundIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0 break-all">{item.publication.publisher}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">v{item.version}</span>
              </CardContent>
            </Link>
            <CardContent className="px-2 pb-2">
              <InteractionControls personaId={item.personaId} counts={item.interactionCounts} />
            </CardContent>
          </Card>
        </article>
      ))}
    </div>
  );
}
