import { Skeleton } from '@personamarket/ui/components/skeleton';
import { PageContainer } from '@/components/page-layout';
export default function Loading() {
  return (
    <PageContainer id="loading-content" aria-busy="true" aria-label="正在加载站点">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-48 w-full" />
    </PageContainer>
  );
}
