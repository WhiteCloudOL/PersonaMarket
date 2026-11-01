'use client';
import { Button } from '@personamarket/ui/components/button';
import { FormNotice } from '../auth/auth-fields';
export function SettingsError({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <FormNotice error={error} />
      <Button variant="outline" onClick={retry}>
        重新读取设置
      </Button>
    </div>
  );
}
