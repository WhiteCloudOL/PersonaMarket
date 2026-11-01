'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@personamarket/ui/components/button';

export function ReloadButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
      className="self-start"
    >
      {pending ? '正在重新加载…' : '重新加载'}
    </Button>
  );
}
