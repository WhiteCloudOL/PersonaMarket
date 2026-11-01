import Link from 'next/link';
import { PageContainer } from '@/components/page-layout';
import {
  AnnouncementBody,
  announcementDate,
} from '@/components/announcements/announcement-content';
import { announcementMetadata, readAnnouncement } from '@/lib/public-announcements';
import {
  Card,
  CardHeader,
  CardContent,
  CardTitle,
  CardDescription,
} from '@personamarket/ui/components/card';
import { Badge } from '@personamarket/ui/components/badge';
import { buttonVariants } from '@personamarket/ui/components/button';
export const dynamic = 'force-dynamic';
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return announcementMetadata((await params).id);
}
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const item = await readAnnouncement((await params).id);
  return (
    <PageContainer size="reading">
      <div>
        <Link href="/announcements" className={buttonVariants({ variant: 'outline' })}>
          全部公告
        </Link>
      </div>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
            {item.pinned && <Badge variant="secondary">置顶公告</Badge>}
            <time dateTime={item.publishedAt}>发布于 {announcementDate(item.publishedAt)}</time>
          </div>
          <CardTitle className="[overflow-wrap:anywhere]">
            <h1 className="text-2xl leading-snug font-bold sm:text-3xl">{item.title}</h1>
          </CardTitle>
          {item.summary && (
            <CardDescription className="text-base leading-7 [overflow-wrap:anywhere]">
              {item.summary}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <AnnouncementBody body={item.body} />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
