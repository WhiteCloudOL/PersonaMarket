import { Suspense } from 'react';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { SettingsShell } from '@/components/settings/settings-shell';
import { PolicyWorkspace } from '@/components/admin/policies/workspace';

export const metadata = { title: '公共规则', robots: { index: false, follow: false } };
export default function Page() {
  return (
    <SettingsShell
      title="公共规则"
      description="分别维护服务条款、隐私与投稿规则，审核后更新公开版"
    >
      <Suspense
        fallback={
          <div role="status">
            <span className="sr-only">正在加载公共规则…</span>
            <Skeleton className="h-64 w-full" aria-hidden="true" />
          </div>
        }
      >
        <PolicyWorkspace />
      </Suspense>
    </SettingsShell>
  );
}
