'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Button } from '@personamarket/ui/components/button';

export function CommentPagination({
  page,
  pageSize,
  total,
  parameter,
  label,
  pending = false,
}: {
  page: number;
  pageSize: number;
  total: number;
  parameter: 'commentsPage' | 'myCommentsPage' | 'repliesPage';
  label: string;
  pending?: boolean;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  function href(next: number) {
    const query = new URLSearchParams(search);
    if (next === 1) query.delete(parameter);
    else query.set(parameter, String(next));
    if (parameter === 'commentsPage') {
      query.delete('replyThread');
      query.delete('repliesPage');
    }
    return pathname + (query.size ? '?' + query : '') + '#comments';
  }
  return (
    <nav aria-label={label} className="flex min-w-0 flex-wrap items-center justify-between gap-3">
      <Button
        variant="outline"
        disabled={pending || page <= 1}
        render={<Link href={href(Math.max(1, page - 1))} scroll={false} />}
      >
        上一页
      </Button>
      <span className="text-sm text-muted-foreground" aria-live="polite">
        第 {page} / {pages} 页
      </span>
      <Button
        variant="outline"
        disabled={pending || page >= pages}
        render={<Link href={href(page + 1)} scroll={false} />}
      >
        下一页
      </Button>
    </nav>
  );
}
