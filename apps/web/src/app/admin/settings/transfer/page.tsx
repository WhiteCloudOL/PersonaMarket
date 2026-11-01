import { Suspense } from 'react';
import { SettingsShell } from '@/components/settings/settings-shell';
import { TransferSettingsForm } from '@/components/settings/transfer-settings-form';
import { Skeleton } from '@personamarket/ui/components/skeleton';

export const metadata = { title: '导入导出', robots: { index: false, follow: false } };
export default function Page() {
  return (
    <SettingsShell title="导入导出" description="设置访客下载和可用格式，文件校验始终保持开启">
      <Suspense
        fallback={
          <div role="status">
            <span className="sr-only">正在加载导入导出…</span>
            <Skeleton className="h-64 w-full" aria-hidden="true" />
          </div>
        }
      >
        <TransferSettingsForm />
      </Suspense>
    </SettingsShell>
  );
}
