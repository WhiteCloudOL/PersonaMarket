import { SettingsShell } from '@/components/settings/settings-shell';
import { AccountSettingsForm } from '@/components/settings/account-settings-form';
export default function Page() {
  return (
    <SettingsShell
      title="账号设置"
      description="管理注册、验证邮件时机与新会话，已有账号可照常登录"
    >
      <AccountSettingsForm />
    </SettingsShell>
  );
}
