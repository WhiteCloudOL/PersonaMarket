import Link from 'next/link';
import { PublicAnnouncementsQuerySchema } from '@personamarket/contracts';
import { PageContainer, PageIntro } from '@/components/page-layout';
import { readAnnouncements } from '@/lib/public-announcements';
import { pageMetadata } from '@/lib/public-seo';
import { announcementDate } from '@/components/announcements/announcement-content';
import { ReloadButton } from '@/components/reload-button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@personamarket/ui/components/card';
import { Badge } from '@personamarket/ui/components/badge';
import { buttonVariants } from '@personamarket/ui/components/button';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@personamarket/ui/components/empty';

export const dynamic = 'force-dynamic';
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const page = (await searchParams)['page'];
  return pageMetadata(
    '/announcements',
    '站点公告',
    '阅读清蒸云鸭·人设市场的公开消息和创作提醒',
    Boolean(page && page !== '1'),
  );
}
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const parsed = PublicAnnouncementsQuerySchema.safeParse({ page: params['page'] ?? 1 });
  const result = parsed.success ? await readAnnouncements(parsed.data) : null;
  return (
    <PageContainer>
      <PageIntro eyebrow="站点消息" title="站点公告" description="阅读公开消息，留意新的创作提醒" />
      {!parsed.success ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p>公告页码无效，请返回第一页</p>
          <Link href="/announcements" className={buttonVariants({ variant: 'outline' })}>
            返回第一页
          </Link>
        </div>
      ) : !result ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p>公告暂时无法读取，可以重新加载</p>
          <ReloadButton />
        </div>
      ) : !result.data.length ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{result.meta.total ? '这一页没有公开公告' : '还没有公开公告'}</EmptyTitle>
            <EmptyDescription>
              {result.meta.total ? '可以返回第一页继续阅读' : '新的站点消息会在这里与你见面'}
            </EmptyDescription>
          </EmptyHeader>
          {result.meta.total > 0 && (
            <Link href="/announcements" className={buttonVariants({ variant: 'outline' })}>
              返回第一页
            </Link>
          )}
        </Empty>
      ) : (
        <>
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            {result.data.map((item) => (
              <Card key={item.id}>
                <CardHeader>
                  <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                    {item.pinned && <Badge variant="secondary">置顶公告</Badge>}
                    <time dateTime={item.publishedAt}>{announcementDate(item.publishedAt)}</time>
                  </div>
                  <CardTitle className="[overflow-wrap:anywhere]">
                    <Link
                      href={'/announcements/' + item.id}
                      className="block min-h-11 content-center rounded-lg outline-offset-4"
                    >
                      <h2>{item.title}</h2>
                    </Link>
                  </CardTitle>
                  {item.summary && (
                    <CardDescription className="text-base [overflow-wrap:anywhere]">
                      {item.summary}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <Link
                    href={'/announcements/' + item.id}
                    className={buttonVariants({ variant: 'outline' })}
                  >
                    阅读全文<span className="sr-only">：{item.title}</span>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
          <nav aria-label="公告分页" className="flex flex-wrap items-center justify-between gap-3">
            {parsed.data.page > 1 ? (
              <Link
                href={'/announcements?page=' + (parsed.data.page - 1)}
                className={buttonVariants({ variant: 'outline' })}
              >
                上一页
              </Link>
            ) : (
              <span className="text-sm text-muted-foreground">已到第一页</span>
            )}
            <span className="text-sm">
              第 {parsed.data.page} 页 · 共 {result.meta.total} 条
            </span>
            {parsed.data.page < 100 &&
            parsed.data.page * parsed.data.pageSize < result.meta.total ? (
              <Link
                href={'/announcements?page=' + (parsed.data.page + 1)}
                className={buttonVariants({ variant: 'outline' })}
              >
                下一页
              </Link>
            ) : (
              <span className="text-sm text-muted-foreground">已到末页</span>
            )}
          </nav>
        </>
      )}
    </PageContainer>
  );
}
