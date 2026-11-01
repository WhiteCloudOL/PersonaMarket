import { SettingsShell } from '@/components/settings/settings-shell';
import { CreationSettingsForm } from '@/components/settings/creation-settings-form';
export default function Page() {
  return (
    <SettingsShell
      title="投稿设置"
      description="管理两个平台的投稿策略和正文上限，调整保留历史内容"
    >
      <CreationSettingsForm />
    </SettingsShell>
  );
}
