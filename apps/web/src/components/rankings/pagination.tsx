import Link from 'next/link';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import type { RankingQuery } from '@personamarket/contracts';
import { buttonVariants } from '@personamarket/ui/components/button';
import { rankingHref } from '@/lib/ranking-state';

export function RankingPagination({ query, total }: { query: RankingQuery; total: number }) {
  const pages = Math.max(1, Math.ceil(total / query.pageSize));
  if (pages === 1 && query.page === 1) return null;
  const visible = Array.from(
    { length: Math.min(5, pages) },
    (_, index) => Math.max(1, Math.min(query.page - 2, pages - 4)) + index,
  );
  return (
    <nav
      aria-label="排行榜分页"
      className="flex min-w-0 flex-wrap items-center justify-center gap-2 py-4"
    >
      {query.page > 1 && (
        <Link
          prefetch={false}
          href={rankingHref({ ...query, page: query.page - 1 })}
          aria-label="上一页"
          className={buttonVariants({ variant: 'outline', size: 'icon' })}
        >
          <ChevronLeftIcon aria-hidden />
        </Link>
      )}
      {visible.map((page) => (
        <Link
          key={page}
          prefetch={false}
          href={rankingHref({ ...query, page })}
          aria-label={'第' + page + '页'}
          aria-current={page === query.page ? 'page' : undefined}
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
          prefetch={false}
          href={rankingHref({ ...query, page: query.page + 1 })}
          aria-label="下一页"
          className={buttonVariants({ variant: 'outline', size: 'icon' })}
        >
          <ChevronRightIcon aria-hidden />
        </Link>
      )}
      <span className="w-full text-center text-sm text-muted-foreground">
        第 {query.page} 页 / 共 {pages} 页
      </span>
    </nav>
  );
}
