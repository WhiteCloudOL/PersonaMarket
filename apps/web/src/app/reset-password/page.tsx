import { AuthShell } from '@/components/auth/auth-shell';
import { ResetPasswordForm } from '@/components/auth/token-forms';
export default function ResetPage() {
  return (
    <AuthShell title="设置新的登录密码" description="使用较长的口令，妥善保护你的账号">
      <ResetPasswordForm />
    </AuthShell>
  );
}
