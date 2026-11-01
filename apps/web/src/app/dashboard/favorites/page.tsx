import { Suspense } from 'react';
import { PageContainer, PageIntro } from '@/components/page-layout';
import { FavoritesList } from '@/components/personas/favorites-list';
export default function Page() {
  return (
    <PageContainer>
      <PageIntro
        eyebrow="创作工作台"
        title="我的收藏"
        description="把喜欢的角色留在身边，收藏仅自己可见"
      />
      <Suspense fallback={<p role="status">正在读取收藏…</p>}>
        <FavoritesList />
      </Suspense>
    </PageContainer>
  );
}
