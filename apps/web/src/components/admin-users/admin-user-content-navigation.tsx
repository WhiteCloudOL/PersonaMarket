'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@personamarket/ui/components/button';

export function useUserContentLocation() {
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    router.push(pathname + (next.size ? '?' + next : ''), { scroll: false });
  }
  return { search, update };
}
export function UserContentPagination({
  page,
  total,
  pending,
  onPageChange,
  label,
}: {
  page: number;
  total: number;
  pending: boolean;
  onPageChange: (page: number) => void;
  label: string;
}) {
  const pages = Math.min(500, Math.max(1, Math.ceil(total / 20)));
  if (page > pages)
    return (
      <nav aria-label={label} className="flex flex-col items-center gap-3">
        <p className="text-sm text-muted-foreground">当前页没有结果，请返回第一页重新查看</p>
        <Button type="button" variant="outline" disabled={pending} onClick={() => onPageChange(1)}>
          返回第一页
        </Button>
      </nav>
    );
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-center gap-3">
      <Button
        type="button"
        variant="outline"
        disabled={pending || page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        上一页
      </Button>
      <span>
        第 {page} / {pages} 页
      </span>
      <Button
        type="button"
        variant="outline"
        disabled={pending || page >= pages}
        onClick={() => onPageChange(page + 1)}
      >
        下一页
      </Button>
    </nav>
  );
}
