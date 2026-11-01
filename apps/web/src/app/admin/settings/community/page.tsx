import { SettingsShell } from '@/components/settings/settings-shell';
import { InteractionSettingsForm } from '@/components/settings/interaction-settings-form';
export default function Page() {
  return (
    <SettingsShell
      title="社区互动设置"
      description="管理点赞、收藏与评论，设置审核策略和公开展示范围"
    >
      <InteractionSettingsForm />
    </SettingsShell>
  );
}
