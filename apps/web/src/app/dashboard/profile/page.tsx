import { PageContainer, PageIntro } from '@/components/page-layout';
import { ProfilesWorkspace } from '@/components/profiles/workspace';
export default function ProfilePage() {
  return (
    <PageContainer size="content">
      <PageIntro
        eyebrow="我的空间"
        title="个人资料"
        description="让读者认识创作者，保存草稿后提交审核"
      />
      <ProfilesWorkspace mode="own" />
    </PageContainer>
  );
}
