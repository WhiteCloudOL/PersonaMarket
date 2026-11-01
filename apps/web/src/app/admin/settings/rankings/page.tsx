import { Suspense } from 'react';
import { SettingsShell } from '@/components/settings/settings-shell';
import { RankingSettingsForm } from '@/components/settings/ranking-settings-form';
import { Skeleton } from '@personamarket/ui/components/skeleton';

export const metadata = { title: '排行与运营', robots: { index: false, follow: false } };
export default function Page() {
  return (
    <SettingsShell title="排行与运营" description="调整新批次的评分和展示规则，保留历史榜单口径">
      <Suspense
        fallback={
          <div role="status">
            <span className="sr-only">正在加载排行与运营…</span>
            <Skeleton className="h-64 w-full" aria-hidden="true" />
          </div>
        }
      >
        <RankingSettingsForm />
      </Suspense>
    </SettingsShell>
  );
}
