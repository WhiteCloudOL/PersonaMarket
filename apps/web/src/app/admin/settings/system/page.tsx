import { SettingsShell } from '@/components/settings/settings-shell';
import { SystemSettingsForm } from '@/components/settings/system-settings-form';
export default function Page() {
  return (
    <SettingsShell title="维护与系统" description="控制新业务提交，保留登录和管理恢复入口">
      <SystemSettingsForm />
    </SettingsShell>
  );
}
