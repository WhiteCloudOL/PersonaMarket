import Link from 'next/link';
import {
  ArrowRightIcon,
  BoxIcon,
  MessageCircleIcon,
  ShieldCheckIcon,
  StarIcon,
  BookOpenIcon,
  SparklesIcon,
  FilePenLineIcon,
} from 'lucide-react';
import type { PublicPersonaCard, PublicPersonaQuery } from '@personamarket/contracts';
import { RecentPlatformFilter } from './recent-platform-filter';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@personamarket/ui/components/card';
import { buttonVariants } from '@personamarket/ui/components/button';
import { Badge } from '@personamarket/ui/components/badge';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
} from '@personamarket/ui/components/empty';
import { cn } from '@personamarket/ui/lib/utils';
import { StorybookArtwork } from './artwork';
import { HomePlatformCard } from './platform-card';
import { PublicCards } from '../personas/public-cards';
import { ReloadButton } from '../reload-button';
const benefits = [
  { icon: FilePenLineIcon, title: '写下你的角色', text: '把细腻的性格和故事写成作品' },
  { icon: MessageCircleIcon, title: '让角色开口说话', text: '用正文和预设对话传递个性' },
  { icon: ShieldCheckIcon, title: '留住创作的足迹', text: '随时查看草稿、版本和审核记录' },
];
export function HomeRecent({
  items,
  platform,
}: {
  items: PublicPersonaCard[] | null;
  platform?: PublicPersonaQuery['platform'];
}) {
  return (
    <section data-home-section="recent" aria-labelledby="home-recent-title">
      <Card className="gap-4">
        <CardHeader className="flex flex-row flex-wrap items-center gap-x-3 gap-y-1">
          <div className="flex min-w-0 max-w-full flex-[1_1_12rem] flex-col gap-1">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className="grid size-9 shrink-0 place-items-center rounded-xl bg-highlight/10"
                aria-hidden
              >
                <StarIcon className="size-5 fill-highlight/20 text-highlight" />
              </span>
              <CardTitle>
                <h2
                  id="home-recent-title"
                  className="scroll-mt-40 text-xl font-semibold text-balance"
                >
                  新近发布
                </h2>
              </CardTitle>
            </div>
            <CardDescription>来自创作者的角色故事，发现有趣的灵魂</CardDescription>
          </div>
          <RecentPlatformFilter platform={platform} />
          <Link
            href={platform ? '/explore?platform=' + platform : '/explore'}
            className="order-1 ml-auto inline-flex min-h-11 shrink-0 items-center justify-end gap-2 text-sm text-muted-foreground hover:text-primary sm:order-2"
          >
            查看全部
            <ArrowRightIcon className="size-4" aria-hidden />
          </Link>
        </CardHeader>
        <CardContent id="home-recent-results">
          <p className="sr-only" role="status">
            {items ? '当前展示 ' + items.length + ' 个公开作品' : '公开作品读取失败'}
          </p>
          {items ? (
            items.length > 0 ? (
              <PublicCards items={items} layout="compact" />
            ) : (
              <Empty className="flex-row flex-wrap items-center justify-center gap-x-4 gap-y-1 p-4 text-left">
                <EmptyMedia className="mb-0 w-18 shrink-0 sm:w-28">
                  <StorybookArtwork />
                </EmptyMedia>
                <div className="flex min-w-0 flex-[1_1_12rem] flex-col gap-1 sm:max-w-sm sm:flex-initial">
                  <EmptyHeader className="items-start gap-1 text-left">
                    <EmptyTitle>
                      <h3>
                        {platform
                          ? (platform === 'maibot' ? 'MaiBot' : 'AstrBot') + ' 还没有公开作品'
                          : '第一个角色，等你来写'}
                      </h3>
                    </EmptyTitle>
                    <EmptyDescription>
                      {platform
                        ? '试试上方的其他平台，或分享你的角色'
                        : '审核通过的作品会展示在这里'}
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent className="items-start">
                    <Link
                      href="/dashboard/personas/new"
                      className={cn(
                        buttonVariants({ variant: 'link' }),
                        'h-auto min-h-11 max-w-full px-0 whitespace-normal',
                      )}
                    >
                      <span className="min-w-0 break-words">分享我的角色</span>
                      <ArrowRightIcon data-icon="inline-end" aria-hidden />
                    </Link>
                  </EmptyContent>
                </div>
              </Empty>
            )
          ) : (
            <div role="alert" className="flex flex-col items-start gap-3">
              <p>暂时无法读取公开作品，可以重新加载</p>
              <ReloadButton />
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
export function HomeCreation() {
  return (
    <div
      data-home-section="creation"
      className="grid items-stretch gap-4 lg:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr]"
    >
      <Card className="gap-4 lg:col-span-2 xl:col-span-1">
        <CardHeader>
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="grid size-9 shrink-0 place-items-center rounded-xl bg-maibot-soft"
            >
              <BoxIcon className="size-5 text-maibot" />
            </span>
            <CardTitle>
              <h2 className="text-xl font-semibold">选择你的平台</h2>
            </CardTitle>
          </div>
          <CardDescription className="sm:pl-12">
            为熟悉的 AI 伙伴，找到恰好的性格和表达
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <HomePlatformCard platform="maibot" />
          <HomePlatformCard platform="astrbot" />
        </CardContent>
      </Card>
      <Card className="gap-4">
        <CardHeader>
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent"
            >
              <BookOpenIcon className="size-5 text-primary" />
            </span>
            <CardTitle>
              <h2 className="text-xl font-semibold">从灵感到分享</h2>
            </CardTitle>
          </div>
          <CardDescription className="sm:pl-12">让你的角色，一步步和大家见面</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-5">
          <ol className="flex flex-col gap-5">
            {[
              ['01', '写下角色', '选择平台，完善设定和作品介绍'],
              ['02', '创建版本', '核对作品授权，再提交审核'],
              ['03', '公开分享', '审核通过后，让更多人看到角色'],
            ].map(([number, title, text]) => (
              <li key={number} className="flex gap-3">
                <Badge variant="secondary" className="size-8 shrink-0 justify-center p-0">
                  {number}
                </Badge>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{title}</h3>
                  <p className="mt-1 text-xs leading-6 text-muted-foreground">{text}</p>
                </div>
              </li>
            ))}
          </ol>
          <Link
            href="/guides"
            className={cn(
              buttonVariants({ variant: 'link' }),
              'mt-auto h-auto min-h-11 max-w-full self-start px-0 whitespace-normal',
            )}
          >
            <span className="min-w-0 break-words">阅读创作指南</span>
            <ArrowRightIcon data-icon="inline-end" aria-hidden />
          </Link>
        </CardContent>
      </Card>
      <Card className="gap-4">
        <CardHeader>
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent"
            >
              <SparklesIcon className="size-5 text-primary" />
            </span>
            <CardTitle>
              <h2 className="text-xl font-semibold">成为创作者</h2>
            </CardTitle>
          </div>
          <CardDescription className="sm:pl-12">
            分享你的创意，让更多人遇见喜欢的角色
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-5">
          <div className="flex flex-1 flex-col gap-5 rounded-xl bg-gradient-to-br from-accent/65 to-card p-4">
            {benefits.map(({ icon: Icon, title, text }) => (
              <div key={title} className="flex gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-card shadow-sm">
                  <Icon className="size-4 text-primary" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{title}</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p>
                </div>
              </div>
            ))}
            <Link
              href="/dashboard/personas/new"
              className={cn(
                buttonVariants(),
                'mt-auto h-auto min-h-11 w-full py-3 whitespace-normal',
              )}
            >
              <span className="min-w-0 break-words">立即发布人设</span>
              <ArrowRightIcon aria-hidden />
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
