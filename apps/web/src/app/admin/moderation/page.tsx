import { Suspense } from 'react';
import { ReviewWorkspace } from '@/components/personas/review-workspace';
import { PageContainer } from '@/components/page-layout';
export default function Page() {
  return (
    <PageContainer>
      <Suspense fallback={<p>正在读取审核队列…</p>}>
        <ReviewWorkspace />
      </Suspense>
    </PageContainer>
  );
}
