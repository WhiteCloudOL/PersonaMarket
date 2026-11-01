import { Suspense } from 'react';
import { PageContainer, PageIntro } from '@/components/page-layout';
import { NotificationsWorkspace } from '@/components/notifications/gate';
import { Skeleton } from '@personamarket/ui/components/skeleton';
export const metadata = { title: '站内通知管理', robots: { index: false, follow: false } };
export default function Page() {
  return (
    <PageContainer>
      <PageIntro
        eyebrow="站点管理"
        title="站内通知管理"
        description="核对收件账号后发送重要说明，随时查看真实投递状态"
      />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <NotificationsWorkspace mode="admin" />
      </Suspense>
    </PageContainer>
  );
}
