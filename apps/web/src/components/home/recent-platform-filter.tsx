'use client';
import { useOptimistic, useSyncExternalStore, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PlatformSchema, type PublicPersonaQuery } from '@personamarket/contracts';
import { ToggleGroup, ToggleGroupItem } from '@personamarket/ui/components/toggle-group';
import { Spinner } from '@personamarket/ui/components/spinner';

const subscribeReadiness = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function RecentPlatformFilter({ platform }: { platform: PublicPersonaQuery['platform'] }) {
  const router = useRouter();
  const search = useSearchParams();
  const hydrated = useSyncExternalStore(subscribeReadiness, clientReady, serverReady);
  const [pending, start] = useTransition();
  const [selected, select] = useOptimistic(platform ?? 'all');
  return (
    <div className="order-2 flex min-w-0 basis-full flex-wrap items-center gap-2 sm:order-1 sm:basis-auto">
      <ToggleGroup
        aria-label="新近发布的平台"
        aria-controls="home-recent-results"
        aria-busy={pending}
        multiple={false}
        disabled={!hydrated}
        value={[selected]}
        variant="outline"
        className="w-full flex-wrap sm:w-fit"
        onValueChange={(values) => {
          const candidate = values[0];
          const parsed = PlatformSchema.safeParse(candidate);
          const next = candidate === 'all' ? 'all' : parsed.success ? parsed.data : null;
          if (!next || next === selected) return;
          const params = new URLSearchParams(search.toString());
          if (next === 'all') params.delete('recentPlatform');
          else params.set('recentPlatform', next);
          const query = params.toString();
          start(() => {
            select(next);
            router.push('/' + (query ? '?' + query : '') + '#home-recent-title', { scroll: false });
          });
        }}
      >
        <ToggleGroupItem
          value="all"
          className="h-auto min-h-11 min-w-max flex-1 whitespace-normal sm:flex-none"
        >
          全部
        </ToggleGroupItem>
        <ToggleGroupItem
          value="maibot"
          className="h-auto min-h-11 min-w-max flex-1 whitespace-normal sm:flex-none"
        >
          MaiBot
        </ToggleGroupItem>
        <ToggleGroupItem
          value="astrbot"
          className="h-auto min-h-11 min-w-max flex-1 whitespace-normal sm:flex-none"
        >
          AstrBot
        </ToggleGroupItem>
      </ToggleGroup>
      <span role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        {pending && (
          <>
            <Spinner aria-hidden />
            正在筛选…
          </>
        )}
      </span>
    </div>
  );
}
