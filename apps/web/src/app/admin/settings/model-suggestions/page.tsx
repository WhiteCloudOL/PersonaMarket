import { Suspense } from 'react';
import { SettingsShell } from '@/components/settings/settings-shell';
import { ModelSuggestionsForm } from '@/components/settings/model-suggestions-form';
import { Skeleton } from '@personamarket/ui/components/skeleton';

export const metadata = { title: '模型建议', robots: { index: false, follow: false } };
export default function Page() {
  return (
    <SettingsShell title="模型建议" description="维护可选模型建议，帮助创作者填写模型信息">
      <Suspense
        fallback={
          <div role="status">
            <span className="sr-only">正在加载模型建议…</span>
            <Skeleton className="h-64 w-full" aria-hidden="true" />
          </div>
        }
      >
        <ModelSuggestionsForm />
      </Suspense>
    </SettingsShell>
  );
}
