import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  ArrowRightIcon,
  FlagIcon,
  ShieldCheckIcon,
  MessageSquareIcon,
  UserRoundIcon,
} from 'lucide-react';
import type { AdminOverview } from '@personamarket/contracts';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardAction,
} from '@personamarket/ui/components/card';
import { Badge } from '@personamarket/ui/components/badge';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@personamarket/ui/components/sheet';
import { Alert, AlertTitle, AlertDescription } from '@personamarket/ui/components/alert';
import { Separator } from '@personamarket/ui/components/separator';
import { cn } from '@personamarket/ui/lib/utils';

type AdministratorOverview = Extract<AdminOverview, { role: 'admin' }>;
const number = (value: number) => value.toLocaleString('zh-CN');
function timestamp(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}
function bytes(value: number) {
  if (value < 1024) return number(value) + ' B';
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KiB';
  return (value / (1024 * 1024)).toFixed(1) + ' MiB';
}
function Figures({ items }: { items: ReadonlyArray<readonly [string, number | string]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 @min-[26rem]:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="flex min-w-0 items-baseline justify-between gap-3">
          <dt className="min-w-0 break-words text-sm text-muted-foreground">{label}</dt>
          <dd className="shrink-0 font-medium tabular-nums">
            {typeof value === 'number' ? number(value) : value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function ReviewQueues({
  data,
  refreshAction,
}: {
  data: AdminOverview;
  refreshAction: ReactNode;
}) {
  const items = [
    {
      label: '人设版本',
      count: data.queues.releases,
      href: '/admin/moderation',
      icon: ShieldCheckIcon,
    },
    {
      label: '评论',
      count: data.queues.comments,
      href: '/admin/comments',
      icon: MessageSquareIcon,
    },
    {
      label: '公开资料',
      count: data.queues.profiles,
      href: '/admin/profiles',
      icon: UserRoundIcon,
    },
    ...(data.role === 'admin'
      ? [{ label: '举报', count: data.queues.reports, href: '/admin/reports', icon: FlagIcon }]
      : []),
  ];
  const total = items.reduce((sum, item) => sum + item.count, 0);
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-48">
          <CardTitle>
            <h2>等待处理</h2>
          </CardTitle>
          <CardDescription className="mt-1">
            {total
              ? '有 ' + number(total) + ' 项内容等待处理，选择队列开始核对'
              : '当前队列已清空，新提交会显示在这里'}
          </CardDescription>
        </div>
        <CardAction>{refreshAction}</CardAction>
      </CardHeader>
      <CardContent className="@container/queues">
        <nav
          aria-label="待处理队列"
          className={cn(
            'grid gap-3',
            data.role === 'admin'
              ? '@min-[38rem]/queues:grid-cols-2'
              : '@min-[38rem]/queues:grid-cols-3',
          )}
        >
          {items.map(({ label, count, href, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="group @container/queue-link block min-h-16 min-w-0 rounded-xl border border-border p-4 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-2 @min-[13rem]/queue-link:flex @min-[13rem]/queue-link:gap-x-3">
                <Icon
                  aria-hidden
                  className="col-start-1 row-start-2 size-5 shrink-0 text-primary"
                />
                <span className="col-span-2 row-start-1 min-w-0 flex-1 break-words font-medium">
                  {label}
                </span>
                <span className="col-start-2 row-start-2 flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2 @min-[13rem]/queue-link:gap-3">
                  <Badge variant={count ? 'default' : 'secondary'}>
                    {number(count)}
                    <span className="sr-only">项</span>
                  </Badge>
                  <ArrowRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </span>
              </div>
            </Link>
          ))}
        </nav>
      </CardContent>
    </Card>
  );
}
export function ActivityPanel({ data }: { data: AdministratorOverview }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>站点近况</h2>
        </CardTitle>
        <CardDescription>仅统计当前可公开访问的作品及有效互动</CardDescription>
      </CardHeader>
      <CardContent className="@container/activity flex flex-col gap-6">
        <dl className="grid grid-cols-1 gap-4 @min-[16rem]/activity:grid-cols-2">
          {[
            ['公开作品', data.catalog.publicPersonas],
            ['可用账号', data.catalog.activeUsers],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="mt-2 text-3xl font-semibold tabular-nums">
                {typeof value === 'number' ? number(value) : value}
              </dd>
            </div>
          ))}
        </dl>
        <Separator />
        <div className="flex flex-col gap-4">
          <h3 className="font-medium">近七天</h3>
          <Figures
            items={[
              ['新公开作品', data.catalog.newPublicPersonas7d],
              ['新增可用账号', data.catalog.newActiveUsers7d],
              ['公开发布版本', data.catalog.publishedReleases7d],
              ['有效点赞', data.interactions.likes7d],
              ['有效收藏', data.interactions.favorites7d],
              ['公开评论', data.interactions.comments7d],
            ]}
          />
        </div>
      </CardContent>
      <CardFooter className="flex-wrap justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          统计于 <time dateTime={data.asOf}>{timestamp(data.asOf)}</time>
        </p>
        <Sheet>
          <SheetTrigger render={<Button variant="ghost" className="min-h-11" />}>
            统计口径
          </SheetTrigger>
          <SheetContent className="sm:max-w-xl">
            <SheetHeader>
              <SheetTitle>统计口径</SheetTitle>
              <SheetDescription>
                数据库统计取自同一个快照，系统观测使用各自采样时间
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-5 px-4 pb-6 text-base leading-7">
              <p>
                近七天为 <time dateTime={data.windowStart}>{timestamp(data.windowStart)}</time> 至{' '}
                <time dateTime={data.asOf}>{timestamp(data.asOf)}</time>，按连续 168 小时计算
              </p>
              <p>
                公开作品须有已通过审核的当前公开版本，隐藏、下架和私有草稿不计入；新公开作品按首次公开时间计算，发布版本按仍可公开访问的版本发布时间计算
              </p>
              <p>
                可用账号是当前未停用的账号总数，包含尚未验证邮箱的账号，不代表访问人数或日活跃人数；新增可用账号同时要求创建时间位于近七天
              </p>
              <p>
                有效点赞和收藏只计当前有效、来自已验证正常账号且非作者本人的关系，时间以首次添加为准，取消重加不会刷新时间；公开评论须已审核通过且仍可公开展示
              </p>
              <p>
                待处理包含待审人设版本、正常显示且有待审版本的评论、待审公开资料，以及待处理或处理中的举报
              </p>
            </div>
          </SheetContent>
        </Sheet>
      </CardFooter>
    </Card>
  );
}
export function OperationsPanel({ data }: { data: AdministratorOverview }) {
  const { storage, queue } = data.observations;
  const failed =
    data.tasks.dispatchFailed > 0 ||
    data.tasks.notificationFailed > 0 ||
    data.tasks.imageImportFailed > 0 ||
    data.tasks.rankingFailed > 0 ||
    (queue.status === 'ready' && queue.failed > 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>运行观测</h2>
        </CardTitle>
        <CardDescription>任务与私有文件的实际读取结果</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {(queue.status !== 'ready' || storage.status !== 'ready') && (
          <Alert>
            <AlertTitle>观测未完整</AlertTitle>
            <AlertDescription>部分观测不可用或只完成部分采样，请展开核对</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">失败记录</span>
          <Badge variant={failed ? 'destructive' : 'secondary'}>
            {failed ? '需要核对' : queue.status === 'ready' ? '未发现失败' : '尚无法确认'}
          </Badge>
        </div>
        <dl className="flex flex-col gap-4">
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-sm text-muted-foreground">队列保留失败</dt>
            <dd className="font-medium tabular-nums">
              {queue.status === 'ready' ? number(queue.failed) : '不可用'}
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-sm text-muted-foreground">分发耗尽重试</dt>
            <dd className="font-medium tabular-nums">{number(data.tasks.dispatchFailed)}</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-sm text-muted-foreground">私有文件用量</dt>
            <dd className="font-medium tabular-nums">
              {storage.status === 'unavailable'
                ? '不可用'
                : (storage.status === 'partial' ? '至少 ' : '') + bytes(storage.bytes)}
            </dd>
          </div>
        </dl>
        <Link
          href="/admin/tasks"
          className={buttonVariants({
            variant: failed ? 'default' : 'outline',
            className: 'min-h-11 w-full',
          })}
        >
          查看失败任务
        </Link>
        <Sheet>
          <SheetTrigger render={<Button variant="ghost" className="min-h-11 w-full" />}>
            查看运行详情
          </SheetTrigger>
          <SheetContent className="sm:max-w-xl">
            <SheetHeader>
              <SheetTitle>运行详情</SheetTitle>
              <SheetDescription>
                只读观测，失败记录可能属于同一任务的不同阶段，数量不能相加
              </SheetDescription>
            </SheetHeader>
            <div className="@container flex flex-col gap-6 px-4 pb-6">
              <section className="flex flex-col gap-4">
                <h3 className="font-semibold">业务失败</h3>
                <Figures
                  items={[
                    ['分发耗尽重试', data.tasks.dispatchFailed],
                    ['其中邮件分发', data.tasks.emailDispatchFailed],
                    ['站内通知失败', data.tasks.notificationFailed],
                    ['图片导入失败', data.tasks.imageImportFailed],
                    ['排行生成失败', data.tasks.rankingFailed],
                  ]}
                />
                <p className="text-sm leading-6 text-muted-foreground">
                  分发失败指尚未进入队列且租约已到期、五次分发已耗尽的事件；业务失败来自各业务数据库状态
                </p>
              </section>
              <Separator />
              <section className="flex flex-col gap-4">
                <h3 className="font-semibold">队列采样</h3>
                {queue.status === 'ready' ? (
                  <Figures
                    items={[
                      ['保留失败', queue.failed],
                      ['等待执行', queue.waiting],
                      ['正在执行', queue.active],
                      ['延迟执行', queue.delayed],
                    ]}
                  />
                ) : (
                  <p role="status">暂时无法读取队列，不能据此认定任务正常</p>
                )}
                <p className="text-sm text-muted-foreground">
                  采样于 <time dateTime={queue.checkedAt}>{timestamp(queue.checkedAt)}</time>
                </p>
                <p className="text-sm leading-6 text-muted-foreground">
                  队列可能保留已被后续处理的历史失败，核对业务状态后再采取操作；此处不显示任务正文或连接信息
                </p>
              </section>
              <Separator />
              <section className="flex flex-col gap-4">
                <h3 className="font-semibold">私有文件采样</h3>
                {storage.status !== 'unavailable' ? (
                  <Figures
                    items={[
                      ['文件数', storage.files],
                      ['文件内容大小', bytes(storage.bytes)],
                      ['采样状态', storage.status === 'ready' ? '完整' : '部分结果'],
                    ]}
                  />
                ) : (
                  <p role="status">暂时无法读取私有文件用量</p>
                )}
                <p className="text-sm text-muted-foreground">
                  采样于 <time dateTime={storage.checkedAt}>{timestamp(storage.checkedAt)}</time>
                </p>
                <p className="text-sm leading-6 text-muted-foreground">
                  仅统计配置存储目录内的普通文件，不跟随链接，不包含数据库、Redis、备份或整个磁盘的占用；观测最多缓存三十秒，文件变化期间可能只有部分结果
                </p>
              </section>
            </div>
          </SheetContent>
        </Sheet>
      </CardContent>
      <CardFooter>
        <Link
          href="/admin/settings/brand"
          className={buttonVariants({ variant: 'ghost', className: 'min-h-11 w-full' })}
        >
          进入站点设置
          <ArrowRightIcon aria-hidden data-icon="inline-end" />
        </Link>
      </CardFooter>
    </Card>
  );
}
