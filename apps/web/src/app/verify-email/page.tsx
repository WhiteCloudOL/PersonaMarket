import { AuthShell } from '@/components/auth/auth-shell';
import { VerifyEmailForm } from '@/components/auth/token-forms';
export default function VerifyPage() {
  return (
    <AuthShell title="验证你的邮箱" description="确认这份邮箱属于你，让账号保持安全">
      <VerifyEmailForm />
    </AuthShell>
  );
}
