import { Suspense } from 'react';
import { PageContainer } from '@/components/page-layout';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { AdminAnnouncementsWorkspace } from '@/components/announcements/admin-workspace';
export const metadata = { title: '公告管理', robots: { index: false, follow: false } };
export default function Page() {
  return (
    <PageContainer>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <AdminAnnouncementsWorkspace />
      </Suspense>
    </PageContainer>
  );
}
