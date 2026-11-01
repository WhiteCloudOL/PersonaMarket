import { Skeleton } from '@personamarket/ui/components/skeleton';
import { PageContainer } from '@/components/page-layout';

export function PolicyLoading() {
  return (
    <PageContainer size="content" aria-label="正在读取公开规则…" aria-busy="true">
      <Skeleton className="h-11 w-28" />
      <div className="flex min-w-0 flex-col gap-6 rounded-2xl border bg-card p-5 sm:p-9">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    </PageContainer>
  );
}
