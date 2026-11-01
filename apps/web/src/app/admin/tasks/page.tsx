import { Suspense } from 'react';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { PageContainer, PageIntro } from '@/components/page-layout';
import { AdminTasksWorkspace } from '@/components/admin-tasks/workspace';

export const metadata = { title: '失败任务', robots: { index: false, follow: false } };
export default function AdminTasksPage() {
  return (
    <PageContainer size="content">
      <PageIntro eyebrow="管理后台" title="失败任务" description="按类型查看任务状态和失败原因" />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <AdminTasksWorkspace />
      </Suspense>
    </PageContainer>
  );
}
