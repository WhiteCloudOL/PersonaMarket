import Link from 'next/link';
import { PageContainer, PageIntro } from '@/components/page-layout';
import { GuideBody } from '@/components/guides/guide-body';
import { readPublicGuide, guideMetadata } from '@/lib/public-guides';
import { buttonVariants } from '@personamarket/ui/components/button';
import { announcementDate } from '@/components/announcements/announcement-content';

export const dynamic = 'force-dynamic';
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  return guideMetadata((await params).slug);
}
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const item = await readPublicGuide((await params).slug);
  return (
    <PageContainer size="reading">
      <Link
        href={'/guides#' + item.slug}
        prefetch={false}
        className={buttonVariants({ variant: 'outline', className: 'self-start' })}
      >
        返回指南目录
      </Link>
      <article className="min-w-0 rounded-2xl border bg-card px-5 py-7 text-card-foreground sm:px-9 sm:py-10">
        <header className="mb-7 flex flex-col gap-4 border-b pb-7">
          <PageIntro eyebrow="使用指南" title={item.title} description={item.summary} />
          <p className="text-sm text-muted-foreground">
            更新于 <time dateTime={item.publishedAt}>{announcementDate(item.publishedAt)}</time>
          </p>
        </header>
        <section aria-labelledby="guide-body-title">
          <h2 id="guide-body-title" className="sr-only">
            指南正文
          </h2>
          <div data-guide-body={item.slug}>
            <GuideBody text={item.bodyMarkdown} />
          </div>
        </section>
      </article>
    </PageContainer>
  );
}
