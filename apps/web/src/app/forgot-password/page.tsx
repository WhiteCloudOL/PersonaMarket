import { AuthShell } from '@/components/auth/auth-shell';
import { ForgotPasswordForm } from '@/components/auth/token-forms';
export default function ForgotPage() {
  return (
    <AuthShell title="找回登录密码" description="通过注册邮箱接收安全的密码重置链接">
      <ForgotPasswordForm />
    </AuthShell>
  );
}
