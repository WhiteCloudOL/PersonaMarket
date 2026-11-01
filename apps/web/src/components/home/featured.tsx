import Link from 'next/link';
import { ArrowRightIcon, SparklesIcon } from 'lucide-react';
import type { PublicPersonaCard } from '@personamarket/contracts';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@personamarket/ui/components/card';
import { PublicCards } from '../personas/public-cards';
import { ReloadButton } from '../reload-button';

export function HomeFeatured({ items }: { items: PublicPersonaCard[] | null }) {
  // 未选作品时收起首页推荐，最新作品区域继续承担首页空态引导
  if (items?.length === 0) return null;
  return (
    <section data-home-section="featured" aria-labelledby="home-featured-title">
      <Card className="gap-4">
        <CardHeader className="flex flex-row flex-wrap items-center gap-x-3 gap-y-1">
          <div className="flex min-w-0 max-w-full items-center gap-3">
            <span
              aria-hidden
              className="grid size-9 shrink-0 place-items-center rounded-xl bg-highlight/10"
            >
              <SparklesIcon className="size-5 text-highlight" />
            </span>
            <CardTitle>
              <h2 id="home-featured-title" className="text-xl font-semibold text-balance">
                精选人设
              </h2>
            </CardTitle>
          </div>
          <Link
            href="/explore?featured=true"
            className="order-1 ml-auto inline-flex min-h-11 shrink-0 items-center justify-end gap-2 text-sm text-muted-foreground hover:text-primary sm:order-2"
          >
            查看全部精选
            <ArrowRightIcon className="size-4" aria-hidden />
          </Link>
          <CardDescription className="order-2 basis-full sm:order-1 sm:flex-[1_1_12rem]">
            经过核对的公开作品，带来一点创作灵感
          </CardDescription>
        </CardHeader>
        <CardContent>
          {items ? (
            <PublicCards items={items} layout="compact" maxColumns={2} />
          ) : (
            <div role="alert" className="flex flex-col items-start gap-3">
              <p className="text-sm text-muted-foreground">精选作品暂时无法读取，可以重新加载</p>
              <ReloadButton />
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
