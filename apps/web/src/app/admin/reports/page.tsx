import { Suspense } from 'react';
import { PageContainer, PageIntro } from '@/components/page-layout';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { ReportsWorkspace } from '@/components/reports/workspace';
export const metadata = { title: '举报处理', robots: { index: false, follow: false } };
export default function Page() {
  return (
    <PageContainer>
      <PageIntro
        eyebrow="站点管理"
        title="举报处理"
        description="核对公开内容和私有线索，记录处理决定与说明"
      />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <ReportsWorkspace mode="admin" />
      </Suspense>
    </PageContainer>
  );
}
