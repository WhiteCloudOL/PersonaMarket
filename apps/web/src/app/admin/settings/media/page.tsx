import { Suspense } from 'react';
import { SettingsShell } from '@/components/settings/settings-shell';
import { MediaSettingsForm } from '@/components/settings/media-settings-form';
import { Skeleton } from '@personamarket/ui/components/skeleton';

export const metadata = { title: '文件与图片', robots: { index: false, follow: false } };
export default function Page() {
  return (
    <SettingsShell title="文件与图片" description="设置图片来源、容量与数量，已有素材继续保留">
      <Suspense
        fallback={
          <div role="status">
            <span className="sr-only">正在加载文件与图片…</span>
            <Skeleton className="h-64 w-full" aria-hidden="true" />
          </div>
        }
      >
        <MediaSettingsForm />
      </Suspense>
    </SettingsShell>
  );
}
