import { Suspense } from 'react';
import { PageContainer, PageIntro } from '@/components/page-layout';
import { NotificationsWorkspace } from '@/components/notifications/gate';
import { Skeleton } from '@personamarket/ui/components/skeleton';
export const metadata = { title: '我的通知', robots: { index: false, follow: false } };
export default function Page() {
  return (
    <PageContainer>
      <PageIntro
        eyebrow="个人工作台"
        title="我的通知"
        description="把审核进展和重要提醒收在一起，安心继续创作"
      />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <NotificationsWorkspace mode="own" />
      </Suspense>
    </PageContainer>
  );
}
