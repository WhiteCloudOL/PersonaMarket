import Link from 'next/link';
import { AccountSecurity } from '@/components/auth/account-security';
import { PageContainer, PageIntro } from '@/components/page-layout';
export default function Page() {
  return (
    <PageContainer size="content">
      <PageIntro
        eyebrow="我的空间 / 安全设置"
        title="账号安全"
        description="在这里更新密码、邮箱与账号状态"
        actions={
          <Link href="/account" className="flex min-h-11 items-center text-sm underline">
            返回账号
          </Link>
        }
      />
      <AccountSecurity />
    </PageContainer>
  );
}
