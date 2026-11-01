import { Suspense } from 'react';
import { PageContainer } from '@/components/page-layout';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { AdminPersonasWorkspace } from '@/components/admin-personas/admin-personas-workspace';

export const metadata = { title: '人设管理', robots: { index: false, follow: false } };

export default function Page() {
  return (
    <PageContainer>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <AdminPersonasWorkspace />
      </Suspense>
    </PageContainer>
  );
}
