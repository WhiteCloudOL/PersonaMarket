import { Suspense } from 'react';
import { PersonaWorkspace } from '@/components/personas/persona-workspace';
import { PageContainer } from '@/components/page-layout';
export default function Page() {
  return (
    <PageContainer>
      <Suspense fallback={<p>正在读取作品…</p>}>
        <PersonaWorkspace />
      </Suspense>
    </PageContainer>
  );
}
