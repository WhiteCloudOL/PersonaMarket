import { AuthShell } from '@/components/auth/auth-shell';
import { EmailChangeConfirm } from '@/components/auth/email-change-confirm';
export default function Page() {
  return (
    <AuthShell title="确认你的新邮箱" description="验证新的联系方式，让账号保持安全">
      <EmailChangeConfirm />
    </AuthShell>
  );
}
