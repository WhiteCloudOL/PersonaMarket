import { PageContainer, PageIntro } from '@/components/page-layout';
import { AdminOverviewWorkspace } from '@/components/admin-overview/workspace';
export const metadata = { title: '管理概览', robots: { index: false, follow: false } };
export default function AdminPage() {
  return (
    <PageContainer size="content">
      <PageIntro
        eyebrow="管理后台"
        title="管理概览"
        description="从待处理内容开始，了解站点的真实状态"
      />
      <AdminOverviewWorkspace />
    </PageContainer>
  );
}
