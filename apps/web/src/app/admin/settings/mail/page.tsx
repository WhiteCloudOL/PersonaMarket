import { SettingsShell } from '@/components/settings/settings-shell';
import { MailSettingsForm } from '@/components/settings/mail-settings-form';
export default function Page() {
  return (
    <SettingsShell
      title="邮件服务设置"
      description="配置 SMTP、保护邮件凭据，并向管理员邮箱发送真实测试邮件"
    >
      <MailSettingsForm />
    </SettingsShell>
  );
}
