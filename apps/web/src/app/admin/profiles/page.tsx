import { PageContainer, PageIntro } from '@/components/page-layout';
import { ProfilesWorkspace } from '@/components/profiles/workspace';
export default function ProfileModerationPage() {
  return (
    <PageContainer>
      <PageIntro
        eyebrow="内容审核"
        title="资料审核"
        description="核对昵称、头像、简介与公开链接，按明确快照处理"
      />
      <ProfilesWorkspace mode="moderation" />
    </PageContainer>
  );
}
