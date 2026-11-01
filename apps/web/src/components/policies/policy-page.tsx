import Link from 'next/link';
import type { PolicySlug } from '@personamarket/contracts';
import { Badge } from '@personamarket/ui/components/badge';
import { buttonVariants } from '@personamarket/ui/components/button';
import { PageContainer, PageIntro } from '@/components/page-layout';
import { announcementDate } from '@/components/announcements/announcement-content';
import { readPublicPolicy } from '@/lib/policies';
import { PolicyReader } from './policy-reader';
import { policyLabels } from './policy-labels';

export async function PolicyPage({
  slug,
  publicationId,
}: {
  slug: PolicySlug;
  publicationId?: string;
}) {
  const item = await readPublicPolicy(slug, publicationId);
  const documentPath = '/' + item.slug + '?publicationId=' + item.publicationId;
  return (
    <PageContainer size="content">
      <div>
        <Link href="/" className={buttonVariants({ variant: 'outline' })}>
          返回首页
        </Link>
      </div>
      <article
        data-policy-document={item.slug}
        data-policy-publication={item.publicationId}
        className="flex min-w-0 flex-col gap-7 rounded-2xl border bg-card px-5 py-7 text-card-foreground sm:px-8 sm:py-9 lg:px-9"
      >
        <header className="flex min-w-0 flex-col gap-5 border-b pb-6">
          <PageIntro
            eyebrow={policyLabels[item.slug]}
            title={item.title}
            description={item.summary}
          />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            <Badge variant="secondary">当前公开版</Badge>
            <span>
              公开于 <time dateTime={item.activatedAt}>{announcementDate(item.activatedAt)}</time>
            </span>
            {item.activatedAt !== item.publishedAt && (
              <span>
                首次发布于{' '}
                <time dateTime={item.publishedAt}>{announcementDate(item.publishedAt)}</time>
              </span>
            )}
            <Link
              href={documentPath}
              prefetch={false}
              className="flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              此版本链接
            </Link>
          </div>
        </header>
        <PolicyReader
          key={item.publicationId}
          text={item.bodyMarkdown}
          publicationId={item.publicationId}
          documentPath={documentPath}
        />
      </article>
    </PageContainer>
  );
}
