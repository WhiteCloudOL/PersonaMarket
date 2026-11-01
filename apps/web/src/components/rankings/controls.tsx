'use client';
import { useEffect, useId, useRef, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  RankingKindSchema,
  RankingWindowSchema,
  RankingPlatformSchema,
  rankingWindows,
  type RankingQuery,
  type RankingKind,
} from '@personamarket/contracts';
import { Card, CardContent } from '@personamarket/ui/components/card';
import { ToggleGroup, ToggleGroupItem } from '@personamarket/ui/components/toggle-group';
import { FieldGroup, FieldSet, FieldLegend } from '@personamarket/ui/components/field';
import { changeRankingFilters, rankingHref } from '@/lib/ranking-state';
import { useClientReady } from '@/hooks/use-client-ready';

const kinds = [
  { value: 'hot', label: '热门' },
  { value: 'likes', label: '点赞' },
  { value: 'favorites', label: '收藏' },
  { value: 'downloads', label: '下载' },
  { value: 'new', label: '新作' },
  { value: 'updated', label: '更新' },
] as const;
const platforms = [
  { value: 'all', label: '全平台' },
  { value: 'maibot', label: 'MaiBot' },
  { value: 'astrbot', label: 'AstrBot' },
] as const;
const windows = [
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: 'all', label: '全部时间' },
  { value: 'newcomer', label: '运营窗口' },
] as const;
const windowHelp: Record<RankingKind, string> = {
  hot: '近7×24小时评分，可展开统计说明查看算法口径',
  likes: '本批统计首次添加在所选范围内、计算时仍有效的非本人点赞',
  favorites: '本批统计首次添加在所选范围内、计算时仍有效的非本人收藏',
  downloads: '近 7 天与近 30 天按 UTC 日期统计，包含今天',
  new: '新作按首次公开时间收录，实际天数以本批统计说明为准，近 30 天保留固定范围',
  updated: '更新榜按当前公开版本的发布时间排序',
};
function FilterGroup({
  title,
  label,
  children,
}: {
  title: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <FieldSet className="@container/ranking-filter min-w-0 gap-0">
      <FieldLegend className="sr-only">{title}</FieldLegend>
      <div className="flex min-w-0 flex-col items-start gap-2 @min-[18rem]/ranking-filter:flex-row @min-[18rem]/ranking-filter:gap-3">
        <span
          aria-hidden="true"
          className="flex min-h-11 shrink-0 items-center text-sm font-medium"
        >
          {label}
        </span>
        {children}
      </div>
    </FieldSet>
  );
}

export function RankingControls({
  initial,
  children,
}: {
  initial: RankingQuery;
  children?: ReactNode;
}) {
  const router = useRouter();
  const hydrated = useClientReady();
  const windowHelpId = useId();
  const [pending, start] = useTransition();
  const requested = useRef(initial);
  useEffect(() => {
    if (!pending) requested.current = initial;
  }, [initial, pending]);
  function change(patch: Parameters<typeof changeRankingFilters>[1]) {
    const next = changeRankingFilters(requested.current, patch);
    requested.current = next;
    start(() => router.push(rankingHref(next), { scroll: false }));
  }
  return (
    <Card size="sm" aria-label="榜单筛选" aria-busy={pending || !hydrated}>
      <CardContent className="flex min-w-0 flex-col gap-1">
        <FieldGroup className="gap-1 lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-x-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
          <FilterGroup title="榜单类型" label="榜单">
            <ToggleGroup
              aria-label="榜单类型选项"
              variant="selection"
              disabled={!hydrated}
              value={[initial.kind]}
              className="w-full min-w-0 flex-1 flex-wrap max-sm:@min-[18rem]/ranking-filter:grid max-sm:@min-[18rem]/ranking-filter:grid-cols-3"
              onValueChange={(values) => {
                const next = RankingKindSchema.safeParse(values[0]);
                if (next.success) change({ kind: next.data });
              }}
            >
              {kinds.map((item) => (
                <ToggleGroupItem
                  key={item.value}
                  value={item.value}
                  className="h-auto min-h-11 min-w-12 whitespace-normal px-3 py-2"
                >
                  {item.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </FilterGroup>
          <FilterGroup title="人设平台" label="平台">
            <ToggleGroup
              aria-label="人设平台选项"
              variant="selection"
              disabled={!hydrated}
              value={[initial.platform]}
              className="w-full min-w-0 flex-1 flex-wrap"
              onValueChange={(values) => {
                const next = RankingPlatformSchema.safeParse(values[0]);
                if (next.success) change({ platform: next.data });
              }}
            >
              {platforms.map((item) => (
                <ToggleGroupItem
                  key={item.value}
                  value={item.value}
                  className="h-auto min-h-11 min-w-12 whitespace-normal px-3 py-2"
                >
                  {item.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </FilterGroup>
          <FilterGroup title="统计范围" label="范围">
            <ToggleGroup
              aria-label="统计范围选项"
              aria-describedby={windowHelpId}
              variant="selection"
              disabled={!hydrated}
              value={[initial.window]}
              className="w-full min-w-0 flex-1 flex-wrap"
              onValueChange={(values) => {
                const next = RankingWindowSchema.safeParse(values[0]);
                if (next.success) change({ window: next.data });
              }}
            >
              {windows
                .filter((item) =>
                  initial.kind === 'new'
                    ? item.value === 'newcomer' || item.value === '30d'
                    : item.value !== 'newcomer',
                )
                .map((item) => (
                  <ToggleGroupItem
                    key={item.value}
                    value={item.value}
                    disabled={!rankingWindows[initial.kind].includes(item.value)}
                    className="h-auto min-h-11 min-w-12 whitespace-normal px-3 py-2"
                  >
                    {item.label}
                  </ToggleGroupItem>
                ))}
            </ToggleGroup>
          </FilterGroup>
        </FieldGroup>
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
          <p
            id={windowHelpId}
            className="min-w-0 flex-1 basis-40 text-xs leading-5 text-muted-foreground"
          >
            {windowHelp[initial.kind]}
          </p>
          {children}
        </div>
        <p role="status" className="sr-only">
          {!hydrated ? '正在准备榜单筛选…' : pending ? '正在切换榜单…' : '榜单筛选已更新'}
        </p>
      </CardContent>
    </Card>
  );
}
