import { Suspense } from 'react';
import { ReleaseManager } from '@/components/personas/release-manager';
import { PageContainer } from '@/components/page-layout';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PageContainer>
      <Suspense fallback={<p>正在读取版本…</p>}>
        <ReleaseManager id={id} />
      </Suspense>
    </PageContainer>
  );
}
