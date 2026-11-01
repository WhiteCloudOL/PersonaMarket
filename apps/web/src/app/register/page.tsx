import { AuthShell } from '@/components/auth/auth-shell';
import { RegisterForm } from '@/components/auth/register-form';
export default function RegisterPage() {
  return (
    <AuthShell title="创建你的账号" description="用邮箱创建账号，按站点指引完成验证">
      <RegisterForm />
    </AuthShell>
  );
}
