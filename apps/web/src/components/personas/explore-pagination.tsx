import Link from 'next/link';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { buttonVariants } from '@personamarket/ui/components/button';
import type { PublicPersonaQuery } from '@personamarket/contracts';
import { exploreHref } from '@/lib/explore-state';

export function ExplorePagination({
  query,
  view,
  total,
}: {
  query: PublicPersonaQuery;
  view: 'grid' | 'list';
  total: number;
}) {
  const pages = Math.ceil(total / query.pageSize);
  if (pages < 2 && query.page === 1) return null;
  const pageNumbers = Array.from(
    { length: Math.min(5, pages) },
    (_, index) => Math.max(1, Math.min(query.page - 2, pages - 4)) + index,
  );
  return (
    <nav
      aria-label="广场分页"
      className="flex min-w-0 flex-wrap items-center justify-center gap-2 py-4"
    >
      {query.page > 1 && (
        <Link
          aria-label="上一页"
          href={exploreHref({ ...query, page: query.page - 1 }, view)}
          className={buttonVariants({ variant: 'outline', size: 'icon' })}
        >
          <ChevronLeftIcon aria-hidden />
        </Link>
      )}
      {pageNumbers.map((page) => (
        <Link
          key={page}
          aria-label={'第' + page + '页'}
          aria-current={page === query.page ? 'page' : undefined}
          href={exploreHref({ ...query, page }, view)}
          className={buttonVariants({
            variant: page === query.page ? 'default' : 'outline',
            size: 'icon',
          })}
        >
          {page}
        </Link>
      ))}
      {query.page < pages && (
        <Link
          aria-label="下一页"
          href={exploreHref({ ...query, page: query.page + 1 }, view)}
          className={buttonVariants({ variant: 'outline', size: 'icon' })}
        >
          <ChevronRightIcon aria-hidden />
        </Link>
      )}
      <span className="w-full text-center text-sm text-muted-foreground">
        第 {query.page} 页 / 共 {Math.max(pages, 1)} 页
      </span>
    </nav>
  );
}
