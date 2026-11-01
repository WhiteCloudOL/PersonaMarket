import Link from 'next/link';
import { MegaphoneIcon, ArrowRightIcon } from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@personamarket/ui/components/card';
import { Badge } from '@personamarket/ui/components/badge';
import type { z } from 'zod';
import type { PublicAnnouncementSummarySchema } from '@personamarket/contracts';
import { ReloadButton } from '../reload-button';
import { announcementDate } from '../announcements/announcement-content';
export function HomeAnnouncements({
  items,
}: {
  items: Array<z.infer<typeof PublicAnnouncementSummarySchema>> | null;
}) {
  if (items?.length === 0) return null;
  return (
    <section data-home-section="announcements" aria-labelledby="home-announcements-title">
      <Card className="gap-4">
        <CardHeader className="flex flex-row flex-wrap items-center gap-x-3 gap-y-1">
          <div className="flex min-w-0 items-center gap-3">
            <MegaphoneIcon className="size-5 shrink-0 text-primary" aria-hidden />
            <CardTitle>
              <h2 id="home-announcements-title">站点公告</h2>
            </CardTitle>
          </div>
          <Link
            href="/announcements"
            className="ml-auto inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-primary"
          >
            查看全部公告
            <ArrowRightIcon className="size-4" aria-hidden />
          </Link>
          <CardDescription className="basis-full">
            留意站点消息，一起照看这个创作角落
          </CardDescription>
        </CardHeader>
        <CardContent>
          {items ? (
            <ul className="flex min-w-0 flex-col gap-3">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="min-w-0 border-b border-border pb-3 last:border-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                    {item.pinned && <Badge variant="secondary">置顶</Badge>}
                    <time dateTime={item.publishedAt}>{announcementDate(item.publishedAt)}</time>
                  </div>
                  <Link
                    href={'/announcements/' + item.id}
                    className="block min-h-11 content-center rounded-lg py-2 text-base font-medium [overflow-wrap:anywhere] outline-offset-4"
                  >
                    {item.title}
                  </Link>
                  {item.summary && (
                    <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                      {item.summary}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div role="alert" className="flex flex-col items-start gap-3">
              <p>公告暂时无法读取，可以重新加载</p>
              <ReloadButton />
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
