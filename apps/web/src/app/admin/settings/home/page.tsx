import { Suspense } from 'react';
import { SettingsShell } from '@/components/settings/settings-shell';
import { HomeSettingsForm } from '@/components/settings/home-settings-form';
import { Skeleton } from '@personamarket/ui/components/skeleton';

export const metadata = { title: '首页展示', robots: { index: false, follow: false } };
export default function Page() {
  return (
    <SettingsShell title="首页展示" description="调整首页阅读顺序和主导航，只展示真实公开内容">
      <Suspense
        fallback={
          <div role="status">
            <span className="sr-only">正在加载首页展示…</span>
            <Skeleton className="h-64 w-full" aria-hidden="true" />
          </div>
        }
      >
        <HomeSettingsForm />
      </Suspense>
    </SettingsShell>
  );
}
