import { AuthShell } from '@/components/auth/auth-shell';
import { MfaForm } from '@/components/auth/mfa-form';
import { creationReturnTo } from '@/lib/creation-auth-return';
export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string; reauth?: string; returnTo?: string }>;
}) {
  const params = await searchParams;
  return (
    <AuthShell title="保护你的账号" description="通过身份验证器完成二次验证">
      <MfaForm
        mode={params.setup === '1' ? 'setup' : params.reauth === '1' ? 'verify' : 'auto'}
        returnTo={creationReturnTo(params.returnTo)}
      />
    </AuthShell>
  );
}
