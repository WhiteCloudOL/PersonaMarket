'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCwIcon } from 'lucide-react';
import { Button } from '@personamarket/ui/components/button';

export function LatestRankingButton({
  href,
  label = '刷新榜单',
}: {
  href: string;
  label?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(() => {
          if (window.location.pathname + window.location.search === href) router.refresh();
          else router.replace(href, { scroll: false });
        })
      }
    >
      <RefreshCwIcon data-icon="inline-start" aria-hidden />
      {pending ? '正在读取…' : label}
    </Button>
  );
}
