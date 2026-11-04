import { Suspense } from 'react';
import { AccountPanel } from '@/components/auth/account-panel';
import { PageContainer, PageIntro } from '@/components/page-layout';
export default function AccountPage() {
  return (
    <PageContainer size="content">
      <PageIntro
        eyebrow="我的空间"
        title="账号管理"
        description="管理邮箱验证、二次验证和登录设备"
      />
      <Suspense fallback={<p role="status">正在读取账号信息…</p>}>
        <AccountPanel />
      </Suspense>
    </PageContainer>
  );
}
