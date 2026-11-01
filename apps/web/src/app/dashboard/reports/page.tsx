import { Suspense } from 'react';
import { PageContainer, PageIntro } from '@/components/page-layout';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { ReportsWorkspace } from '@/components/reports/workspace';
export const metadata = { title: '我的举报', robots: { index: false, follow: false } };
export default function Page() {
  return (
    <PageContainer size="content">
      <PageIntro
        eyebrow="我的账号"
        title="我的举报"
        description="跟进自己提交的举报，查看处理状态和管理员说明"
      />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <ReportsWorkspace mode="own" />
      </Suspense>
    </PageContainer>
  );
}
