import Link from 'next/link';
import type { Metadata } from 'next';
import { CreatorParamsSchema, CreatorPersonasQuerySchema } from '@personamarket/contracts';
import { notFound } from 'next/navigation';
import { readPublicCreator, readCreatorPersonas } from '@/lib/public-creators';
import { PageContainer } from '@/components/page-layout';
import { ProfileContentView } from '@/components/profiles/content';
import { PublicCards } from '@/components/personas/public-cards';
import { ReportButton } from '@/components/reports/report-button';
import { Badge } from '@personamarket/ui/components/badge';
import { buttonVariants } from '@personamarket/ui/components/button';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@personamarket/ui/components/empty';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  if (!CreatorParamsSchema.safeParse({ username }).success) notFound();
  const creator = await readPublicCreator(username);
  return {
    title: creator.displayName + ' 的创作主页',
    description: Array.from(creator.bio || '浏览这位创作者公开的人设作品')
      .slice(0, 160)
      .join(''),
    robots: { index: Boolean(creator.approvedRevisionId), follow: true },
  };
}

export default async function CreatorPage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ username }, raw] = await Promise.all([params, searchParams]);
  if (!CreatorParamsSchema.safeParse({ username }).success) notFound();
  const input = CreatorPersonasQuerySchema.safeParse({
    page: raw['page'] ?? 1,
    pageSize: 12,
    sort: raw['sort'] ?? 'newest',
    ...(raw['platform'] ? { platform: raw['platform'] } : {}),
  });
  if (!input.success)
    return (
      <PageContainer>
        <h1 className="text-2xl font-semibold">作品筛选条件无效</h1>
        <Link href={'/users/' + username} className={buttonVariants({ variant: 'outline' })}>
          清空作品筛选
        </Link>
      </PageContainer>
    );
  const [creator, works] = await Promise.all([
    readPublicCreator(username),
    readCreatorPersonas(username, input.data),
  ]);
  function link(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...input.data, ...patch })) {
      if (value !== undefined && key !== 'pageSize') next.set(key, String(value));
    }
    return '/users/' + username + (next.size ? '?' + next : '');
  }
  return (
    <PageContainer>
      <nav aria-label="面包屑">
        <Link
          href="/explore"
          className="flex min-h-11 w-fit items-center text-sm text-primary underline underline-offset-4"
        >
          探索人设
        </Link>
      </nav>
      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <header className="flex min-w-0 flex-col gap-5 rounded-2xl border bg-card p-5 sm:p-7 lg:sticky lg:top-28">
          <div className="flex min-w-0 flex-col gap-5">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="outline">创作者</Badge>
              <p className="break-all text-sm text-muted-foreground">@{creator.username}</p>
            </div>
            <ProfileContentView
              content={{
                displayName: creator.displayName,
                bio: creator.bio,
                links: creator.links,
                avatarAssetId: null,
              }}
              avatarSrc={creator.avatarUrl}
            >
              <h1 className="text-3xl font-semibold text-balance [overflow-wrap:anywhere]">
                {creator.displayName}
              </h1>
            </ProfileContentView>
          </div>
          {creator.approvedRevisionId && (
            <ReportButton
              target={{
                type: 'profile',
                userId: creator.id,
                submissionId: creator.approvedRevisionId,
              }}
            />
          )}
        </header>
        <section aria-labelledby="creator-works-heading" className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 id="creator-works-heading" className="text-xl font-semibold">
              公开作品{' '}
              <span className="text-sm font-normal text-muted-foreground">
                {works.meta.total} 部
              </span>
            </h2>
            <nav aria-label="创作者作品平台" className="flex flex-wrap gap-2">
              {[
                { value: undefined, label: '全部平台' },
                { value: 'maibot', label: 'MaiBot' },
                { value: 'astrbot', label: 'AstrBot' },
              ].map((option) => (
                <Link
                  key={option.value ?? 'all'}
                  href={link({ platform: option.value, page: undefined })}
                  aria-current={input.data.platform === option.value ? 'page' : undefined}
                  className={buttonVariants({
                    variant: input.data.platform === option.value ? 'secondary' : 'ghost',
                  })}
                >
                  {option.label}
                </Link>
              ))}
            </nav>
          </div>
          {works.data.length ? (
            <PublicCards items={works.data} layout="compact" maxColumns={2} />
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  <h3>还没有可展示的作品</h3>
                </EmptyTitle>
                <EmptyDescription>只有当前可公开访问的已发布人设会出现在这里</EmptyDescription>
              </EmptyHeader>
              <Link className={buttonVariants({ variant: 'outline' })} href="/explore">
                继续探索人设
              </Link>
            </Empty>
          )}
          {works.meta.total > 12 && (
            <nav
              aria-label="创作者作品分页"
              className="flex flex-wrap items-center justify-between gap-3"
            >
              {input.data.page > 1 ? (
                <Link
                  className={buttonVariants({ variant: 'outline' })}
                  href={link({ page: String(input.data.page - 1) })}
                >
                  上一页
                </Link>
              ) : (
                <span />
              )}
              <p className="text-sm text-muted-foreground">第 {input.data.page} 页</p>
              {input.data.page * 12 < works.meta.total ? (
                <Link
                  className={buttonVariants({ variant: 'outline' })}
                  href={link({ page: String(input.data.page + 1) })}
                >
                  下一页
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </section>
      </div>
    </PageContainer>
  );
}
