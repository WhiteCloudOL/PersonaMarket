import { AuthShell } from '@/components/auth/auth-shell';
import { LoginForm } from '@/components/auth/login-form';
import { FormNotice } from '@/components/auth/auth-fields';
import { creationReturnTo } from '@/lib/creation-auth-return';
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; returnTo?: string }>;
}) {
  const params = await searchParams;
  const notice = params.notice;
  return (
    <AuthShell title="欢迎回来" description="登录清蒸云鸭，继续管理你的账号">
      {notice === 'password-changed' && (
        <div className="mb-5">
          <FormNotice message="密码已更新，请使用新密码重新登录" />
        </div>
      )}
      {notice === 'email-changed' && (
        <div className="mb-5">
          <FormNotice message="新邮箱已确认，请使用新邮箱或用户名重新登录" />
        </div>
      )}
      <LoginForm returnTo={creationReturnTo(params.returnTo)} />
    </AuthShell>
  );
}
