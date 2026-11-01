import { Suspense } from 'react';
import { PageContainer } from '@/components/page-layout';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { TaxonomyWorkspace } from '@/components/taxonomy-management/taxonomy-workspace';
export const metadata = { title: '分类管理', robots: { index: false, follow: false } };
export default function Page() {
  return (
    <PageContainer>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <TaxonomyWorkspace kind="category" />
      </Suspense>
    </PageContainer>
  );
}
