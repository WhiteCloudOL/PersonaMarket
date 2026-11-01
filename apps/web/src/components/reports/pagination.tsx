'use client';
import { Button } from '@personamarket/ui/components/button';

export function ReportPagination({
  page,
  total,
  change,
  busy,
  label,
}: {
  page: number;
  total: number;
  change: (page: number) => void;
  busy: boolean;
  label: string;
}) {
  const pages = Math.max(1, Math.ceil(total / 20));
  return (
    <nav aria-label={label} className="flex min-w-0 flex-wrap items-center justify-between gap-3">
      <Button variant="outline" disabled={busy || page <= 1} onClick={() => change(page - 1)}>
        上一页
      </Button>
      <span className="text-sm text-muted-foreground" aria-live="polite">
        第 {page} / {pages} 页
      </span>
      <Button
        variant="outline"
        disabled={busy || page >= Math.min(500, pages)}
        onClick={() => change(page + 1)}
      >
        下一页
      </Button>
    </nav>
  );
}
