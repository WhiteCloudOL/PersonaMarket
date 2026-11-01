import Link from 'next/link';
import { pageMetadata } from '@/lib/public-seo';
import Image from 'next/image';
import { SearchXIcon } from 'lucide-react';
import { PublicPersonaQuerySchema, canonicalJson } from '@personamarket/contracts';
import { readPublicPersonas, readPublicFacets } from '@/lib/public-personas';
import { ExplorePagination } from '@/components/personas/explore-pagination';
import { PublicCards } from '@/components/personas/public-cards';
import { ExploreFilters } from '@/components/personas/explore-filters';
import { PersonaSearch } from '@/components/persona-search';
import { ReloadButton } from '@/components/reload-button';
import { PageContainer } from '@/components/page-layout';
import { buttonVariants } from '@personamarket/ui/components/button';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@personamarket/ui/components/empty';
import { exploreEmptyState, exploreHref } from '@/lib/explore-state';
export const dynamic = 'force-dynamic';
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return pageMetadata(
    '/explore',
    '探索人设',
    '搜索中文人设、作者、标签与 README，按平台、模型、来源与发布时间发现 MaiBot 和 AstrBot 公开作品',
    Object.values(params).some((value) => value !== undefined && value !== ''),
  );
}
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const parsed = PublicPersonaQuerySchema.safeParse({
    page: params['page'] ?? 1,
    pageSize: 12,
    q: params['q'] ?? '',
    sort: params['sort'] ?? 'relevance',
    platform: params['platform'] || undefined,
    categoryId: params['categoryId'] || undefined,
    tagId: params['tagId'] || undefined,
    tagIds: params['tagIds'] || undefined,
    hasDialogue: params['hasDialogue'] || undefined,
    featured: params['featured'] || undefined,
    publishedWithin: params['publishedWithin'] ?? 'all',
    model: params['model'] || undefined,
    origin: params['origin'] || undefined,
    redistribution: params['redistribution'] || undefined,
  });
  const query = parsed.success ? parsed.data : PublicPersonaQuerySchema.parse({ pageSize: 12 });
  const view = params['view'] === 'list' ? 'list' : 'grid';
  const [list, facets] = await Promise.all([
    parsed.success ? readPublicPersonas(query) : Promise.resolve(null),
    readPublicFacets(),
  ]);
  const hidden: Record<string, string> = { sort: query.sort, view };
  for (const key of [
    'categoryId',
    'tagId',
    'tagIds',
    'model',
    'origin',
    'redistribution',
    'publishedWithin',
    'hasDialogue',
    'featured',
  ] as const) {
    const value = query[key];
    if (value) hidden[key] = value;
  }
  return (
    <PageContainer>
      <section className="relative isolate flex min-h-52 flex-col justify-center gap-5 py-5">
        <div
          aria-hidden="true"
          className="explore-intro-art pointer-events-none absolute inset-y-0 right-0 hidden w-[52%] md:block"
        >
          <Image
            src="/images/anime-discovery-library.png"
            alt=""
            fill
            priority
            sizes="(min-width: 768px) 50vw, 0px"
            className="object-cover object-[right_18%]"
          />
        </div>
        <div className="relative z-10 flex min-w-0 flex-col gap-4 md:max-w-[72%] lg:max-w-[64%]">
          <h1 className="text-4xl leading-tight font-extrabold tracking-tight sm:text-5xl">
            探索<span className="text-primary">人设</span>
          </h1>
          <p className="text-base font-medium text-muted-foreground sm:text-lg">
            发现更多有趣的角色，遇见让你心动的设定
          </p>
          <PersonaSearch
            key={canonicalJson(query)}
            query={query.q}
            {...(query.platform ? { platform: query.platform } : {})}
            filters={hidden}
          />
        </div>
      </section>
      {facets ? (
        <ExploreFilters initial={query} initialView={view} facets={facets} />
      ) : (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-xl border p-4 text-sm"
        >
          <p>筛选选项暂时无法读取，请刷新重试</p>
          <ReloadButton />
        </div>
      )}
      <section className="flex min-w-0 flex-col gap-4" aria-label="人设结果">
        {!parsed.success ? (
          <div role="alert" className="flex flex-col items-start gap-3 py-8">
            <p>筛选条件格式不正确，请清空后重试</p>
            <Link href="/explore" className={buttonVariants({ variant: 'ghost' })}>
              清空条件
            </Link>
          </div>
        ) : list ? (
          <>
            <p className="break-all text-sm text-muted-foreground">
              {list.meta.capped ? '展示前 ' : '找到 '}
              {list.meta.total.toLocaleString('zh-CN')} 个人设
              {query.q ? ' · “' + query.q + '”' : ''}
            </p>
            {list.meta.capped && (
              <p className="text-sm text-muted-foreground">
                结果较多，可增加关键词或筛选条件找到更合适的角色
              </p>
            )}
            {list.data.length > 0 ? (
              <PublicCards items={list.data} layout={view === 'list' ? 'list' : 'cover'} />
            ) : (
              <Empty role="status" className="py-16">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <SearchXIcon aria-hidden />
                  </EmptyMedia>
                  <EmptyTitle>
                    {exploreEmptyState(query, list.meta.total) === 'page-empty'
                      ? '这一页没有作品'
                      : exploreEmptyState(query, list.meta.total) === 'catalogue-empty'
                        ? '暂无公开作品'
                        : '没有找到匹配的人设'}
                  </EmptyTitle>
                  <EmptyDescription>
                    {exploreEmptyState(query, list.meta.total) === 'page-empty'
                      ? '作品状态或总数可能已变化，请返回前面的页码继续查看'
                      : exploreEmptyState(query, list.meta.total) === 'catalogue-empty'
                        ? '审核通过的公开作品会显示在这里，可以先阅读指南了解平台与使用方式'
                        : '试试调整关键词或筛选条件，也可以清空限制重新发现作品'}
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  {exploreEmptyState(query, list.meta.total) === 'page-empty' ? (
                    <Link
                      href={exploreHref({ ...query, page: 1 }, view)}
                      className={buttonVariants({ variant: 'outline' })}
                    >
                      返回第一页
                    </Link>
                  ) : exploreEmptyState(query, list.meta.total) === 'catalogue-empty' ? (
                    <Link href="/guides" className={buttonVariants({ variant: 'outline' })}>
                      阅读使用指南
                    </Link>
                  ) : (
                    <Link
                      href={exploreHref({}, view)}
                      className={buttonVariants({ variant: 'ghost' })}
                    >
                      清空条件
                    </Link>
                  )}
                </EmptyContent>
              </Empty>
            )}
            <ExplorePagination query={query} view={view} total={list.meta.total} />
          </>
        ) : (
          <div role="alert" className="flex flex-col items-start gap-4 py-8">
            <p>暂时无法读取人设结果，请稍后重试</p>
            <ReloadButton />
          </div>
        )}
      </section>
    </PageContainer>
  );
}
