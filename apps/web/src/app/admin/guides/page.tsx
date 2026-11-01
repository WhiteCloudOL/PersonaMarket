import { Suspense } from 'react';
import { PageContainer } from '@/components/page-layout';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { AdminGuidesWorkspace } from '@/components/guides/admin-workspace';
export const metadata = { title: '指南内容', robots: { index: false, follow: false } };
export default function Page() {
  return (
    <PageContainer>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <AdminGuidesWorkspace />
      </Suspense>
    </PageContainer>
  );
}
