import { Suspense } from 'react';
import { PageContainer } from '@/components/page-layout';
import { AdminUsersWorkspace } from '@/components/admin-users/admin-users-workspace';
import { Skeleton } from '@personamarket/ui/components/skeleton';

export default function Page() {
  return (
    <PageContainer>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <AdminUsersWorkspace />
      </Suspense>
    </PageContainer>
  );
}
