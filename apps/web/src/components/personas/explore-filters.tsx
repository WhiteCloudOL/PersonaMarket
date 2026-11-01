'use client';
import { RankingRules } from './ranking-rules';
import { useClientReady } from '@/hooks/use-client-ready';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Grid2X2Icon, ListIcon, SlidersHorizontalIcon, RotateCcwIcon } from 'lucide-react';
import {
  PublicPersonaQuerySchema,
  publicPersonaTagIds,
  type PublicPersonaQuery,
  type PublicFacets,
} from '@personamarket/contracts';
import { Card, CardContent } from '@personamarket/ui/components/card';
import { ToggleGroup, ToggleGroupItem } from '@personamarket/ui/components/toggle-group';
import { FieldGroup } from '@personamarket/ui/components/field';
import { Button } from '@personamarket/ui/components/button';
import { Badge } from '@personamarket/ui/components/badge';
import {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@personamarket/ui/components/sheet';
import { exploreHref } from '@/lib/explore-state';
import { cn } from '@personamarket/ui/lib/utils';
import { ExploreChipRow } from './explore-chip-row';
import { SortControl, FilterSelect, type FilterRow } from './explore-filter-controls';
import { appliedExploreFilters, AppliedExploreFilters } from './explore-applied-filters';

type AdvancedFilters = Pick<
  PublicPersonaQuery,
  FilterRow['key'] | 'categoryId' | 'tagId' | 'tagIds'
>;
const emptyAdvanced: AdvancedFilters = {
  categoryId: undefined,
  tagId: undefined,
  tagIds: undefined,
  model: undefined,
  origin: undefined,
  redistribution: undefined,
  publishedWithin: 'all',
  hasDialogue: undefined,
  featured: undefined,
};
function advancedFilters(query: PublicPersonaQuery): AdvancedFilters {
  return {
    categoryId: query.categoryId,
    tagId: query.tagId,
    tagIds: query.tagIds,
    model: query.model,
    origin: query.origin,
    redistribution: query.redistribution,
    publishedWithin: query.publishedWithin,
    hasDialogue: query.hasDialogue,
    featured: query.featured,
  };
}
function visibleTrigger(fieldset: HTMLFieldSetElement | null) {
  return Array.from(
    fieldset?.querySelectorAll<HTMLButtonElement>('[data-explore-filter-trigger]') ?? [],
  ).find((button) => button.getClientRects().length > 0);
}
function ClearExploreFilters({ onClear }: { onClear: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-auto min-h-11 max-w-full shrink-0 whitespace-normal"
      onClick={onClear}
    >
      <RotateCcwIcon aria-hidden data-icon="inline-start" />
      清空筛选
    </Button>
  );
}
export function ExploreFilters({
  initial,
  initialView,
  facets,
}: {
  initial: PublicPersonaQuery;
  initialView: 'grid' | 'list';
  facets: PublicFacets;
}) {
  const [open, setOpen] = useState(false);
  const [triggerId, setTriggerId] = useState<string | null>(null);
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState('');
  const [draftError, setDraftError] = useState('');
  const [pending, start] = useTransition();
  const requested = useRef(initial);
  const queued = useRef<AdvancedFilters | null>(null);
  const restoreFocus = useRef(false);
  const fieldset = useRef<HTMLFieldSetElement>(null);
  const id = useId();
  useEffect(() => {
    if (!pending) requested.current = initial;
  }, [initial, pending]);
  useEffect(() => {
    if (pending || !restoreFocus.current) return;
    restoreFocus.current = false;
    visibleTrigger(fieldset.current)?.focus({ preventScroll: true });
  }, [initial, pending]);
  const router = useRouter();
  const hydrated = useClientReady();
  const rows: FilterRow[] = [
    {
      key: 'featured',
      label: '精选状态',
      options: [
        { value: 'true', label: '精选作品' },
        { value: 'false', label: '未设精选' },
      ],
    },
    { key: 'model', label: '推荐模型', options: facets.models },
    { key: 'origin', label: '作品来源', options: facets.origins },
    { key: 'redistribution', label: '转载规则', options: facets.policies },
    {
      key: 'publishedWithin',
      label: '首次发布时间',
      options: [
        { value: '7d', label: '最近7天' },
        { value: '30d', label: '最近30天' },
      ],
    },
    {
      key: 'hasDialogue',
      label: '预设对话',
      options: [
        { value: 'true', label: '包含 AstrBot 对话' },
        { value: 'false', label: '没有预设对话' },
      ],
    },
  ];
  const applied = appliedExploreFilters(initial, facets, rows);
  const update = (patch: Partial<PublicPersonaQuery>, view = initialView) => {
    const checked = PublicPersonaQuerySchema.safeParse({ ...requested.current, ...patch, page: 1 });
    if (!checked.success) {
      setError(checked.error.issues[0]?.message ?? '筛选条件无效，请清空后重试');
      return false;
    }
    setError('');
    requested.current = checked.data;
    const href = exploreHref(checked.data, view);
    if (href === exploreHref(initial, initialView)) return false;
    start(() => router.push(href, { scroll: false }));
    return true;
  };
  const reset = () => {
    const cleared = PublicPersonaQuerySchema.parse({});
    requested.current = cleared;
    setError('');
    restoreFocus.current = true;
    start(() => router.push(exploreHref(cleared, initialView), { scroll: false }));
  };
  return (
    <Sheet
      open={open}
      triggerId={triggerId}
      onOpenChange={(next, details) => {
        queued.current = null;
        if (next) {
          setTriggerId(details.trigger?.id ?? null);
          setDraft(initial);
          setDraftError('');
        }
        setOpen(next);
      }}
      onOpenChangeComplete={(next) => {
        if (next || !queued.current) return;
        const patch = queued.current;
        queued.current = null;
        // 等弹层恢复焦点与滚动后再跳转，避免禁用控件打断 Base UI 的关闭清理。
        if (update(patch)) restoreFocus.current = true;
      }}
    >
      <Card className="gap-0" aria-label="发现与筛选">
        <CardContent className="@container/explore-filters">
          <fieldset
            ref={fieldset}
            disabled={pending || !hydrated}
            aria-busy={pending || !hydrated}
            className="flex min-w-0 flex-col gap-4"
          >
            <legend className="sr-only">人设筛选与排序</legend>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
              <ToggleGroup
                aria-label="人设平台"
                variant="selection"
                className="w-full flex-wrap lg:w-auto"
                value={[initial.platform ?? '__all']}
                onValueChange={(values) => {
                  const value = values[0];
                  if (value === '__all' || value === 'maibot' || value === 'astrbot')
                    update({ platform: value === '__all' ? undefined : value });
                }}
              >
                <ToggleGroupItem value="__all" className="min-h-11 min-w-fit flex-1 lg:flex-none">
                  全部
                </ToggleGroupItem>
                <ToggleGroupItem value="maibot" className="min-h-11 min-w-fit flex-1 lg:flex-none">
                  MaiBot
                </ToggleGroupItem>
                <ToggleGroupItem value="astrbot" className="min-h-11 min-w-fit flex-1 lg:flex-none">
                  AstrBot
                </ToggleGroupItem>
              </ToggleGroup>
              <div className="hidden min-w-0 max-w-full flex-wrap items-center gap-2 lg:flex">
                {(applied.length > 0 || initial.q) && <ClearExploreFilters onClear={reset} />}
                <SheetTrigger
                  id={id + '-desktop'}
                  render={<Button type="button" variant="outline" data-explore-filter-trigger />}
                >
                  <SlidersHorizontalIcon aria-hidden data-icon="inline-start" />
                  高级筛选
                  {applied.length > 0 && <Badge variant="secondary">{applied.length}</Badge>}
                </SheetTrigger>
                <SortControl
                  value={initial.sort}
                  pending={pending}
                  onChange={(sort) => update({ sort })}
                />
                <ToggleGroup
                  aria-label="结果视图"
                  variant="selection"
                  value={[initialView]}
                  onValueChange={(values) => {
                    if (values[0] === 'grid' || values[0] === 'list') update({}, values[0]);
                  }}
                >
                  <ToggleGroupItem value="grid" aria-label="卡片视图" className="min-h-11 min-w-11">
                    <Grid2X2Icon aria-hidden />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="list" aria-label="列表视图" className="min-h-11 min-w-11">
                    <ListIcon aria-hidden />
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>
            <div className="lg:hidden">
              <div className="flex min-w-0 flex-col items-stretch gap-2 @min-[18rem]/explore-filters:grid @min-[18rem]/explore-filters:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <SheetTrigger
                  id={id + '-mobile'}
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      aria-label="筛选人设"
                      data-explore-filter-trigger
                      className="h-auto min-h-11 min-w-0 whitespace-normal"
                    />
                  }
                >
                  <SlidersHorizontalIcon aria-hidden data-icon="inline-start" />
                  筛选{applied.length > 0 && <Badge variant="secondary">{applied.length}</Badge>}
                </SheetTrigger>
                <SortControl
                  value={initial.sort}
                  pending={pending}
                  className="w-full lg:w-full"
                  onChange={(sort) => update({ sort })}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={initialView === 'grid' ? '列表视图' : '卡片视图'}
                  onClick={() => update({}, initialView === 'grid' ? 'list' : 'grid')}
                  className="self-end"
                >
                  {initialView === 'grid' ? <ListIcon aria-hidden /> : <Grid2X2Icon aria-hidden />}
                </Button>
              </div>
            </div>
            {(applied.length > 0 || initial.q) && (
              <div className={cn('min-w-0 border-t pt-3', applied.length === 0 && 'lg:hidden')}>
                <AppliedExploreFilters
                  filters={applied}
                  onRemove={(patch) => {
                    if (update(patch)) restoreFocus.current = true;
                  }}
                >
                  <div className="ml-auto lg:hidden">
                    <ClearExploreFilters onClear={reset} />
                  </div>
                </AppliedExploreFilters>
              </div>
            )}
            {(initial.sort === 'downloads' ||
              initial.sort === 'recent-downloads' ||
              initial.sort === 'hot' ||
              initial.sort === 'likes' ||
              initial.sort === 'favorites') && (
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <p className="min-w-0 flex-1 basis-40 text-sm leading-6 text-muted-foreground">
                  {initial.sort === 'hot'
                    ? '近7×24小时互动热度，按7天半衰期计算'
                    : initial.sort === 'likes' || initial.sort === 'favorites'
                      ? '按当前有效非本人关系排序，作品按钮显示的总数包含本人互动'
                      : initial.sort === 'recent-downloads'
                        ? '统计今天及此前6个 UTC 日期的有效导出，同一人同一作品每天最多计一次，作者本人导出不计入'
                        : '统计累计有效导出，同一人同一作品每天最多计一次，作者本人导出不计入'}
                </p>
                <RankingRules title="热度和导出如何计算" closeLabel="返回探索" />
              </div>
            )}
            {(pending || error) && (
              <p role={error ? 'alert' : 'status'} className="text-sm text-muted-foreground">
                {error || '正在更新筛选结果…'}
              </p>
            )}
          </fieldset>
        </CardContent>
      </Card>
      <SheetContent
        side="bottom"
        finalFocus={() => visibleTrigger(fieldset.current)}
        className="mx-auto w-full max-w-4xl gap-0 overflow-hidden rounded-t-3xl data-[side=bottom]:h-[min(92dvh,48rem)]"
      >
        <SheetHeader className="shrink-0 border-b p-5 pr-16">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SheetTitle>筛选人设</SheetTitle>
            <Button
              type="button"
              variant="ghost"
              className="h-auto min-h-11 max-w-full whitespace-normal"
              onClick={() => {
                setDraft({ ...initial, ...emptyAdvanced });
                setDraftError('');
              }}
            >
              重置筛选
            </Button>
          </div>
          <SheetDescription>按喜欢的设定寻找角色，确认后更新结果</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6">
          <div className="flex flex-col gap-6">
            <ExploreChipRow
              label="分类"
              options={facets.categories.map((item) => ({ value: item.id, label: item.name }))}
              values={draft.categoryId ? [draft.categoryId] : []}
              onChange={(values) => setDraft({ ...draft, categoryId: values[0] })}
            />
            <ExploreChipRow
              label="标签 / 风格"
              options={facets.tags.map((item) => ({ value: item.id, label: item.name }))}
              values={publicPersonaTagIds(draft)}
              multiple
              onChange={(values) => {
                if (values.length > 8) {
                  setDraftError('最多同时选择8个标签');
                  return;
                }
                setDraftError('');
                setDraft({
                  ...draft,
                  tagId: undefined,
                  tagIds: values.length ? values.join(',') : undefined,
                });
              }}
            />
            <p className="text-sm text-muted-foreground">多选标签同时匹配，最多选择8个</p>
            <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {rows.map((row) => (
                <FilterSelect
                  key={row.key}
                  row={row}
                  value={draft[row.key] === 'all' ? undefined : draft[row.key]}
                  scope="advanced"
                  onChange={(value) =>
                    setDraft({
                      ...draft,
                      [row.key]: row.key === 'publishedWithin' ? (value ?? 'all') : value,
                    })
                  }
                />
              ))}
            </FieldGroup>
            {draftError && (
              <p role="alert" className="text-destructive">
                {draftError}
              </p>
            )}
          </div>
        </div>
        <SheetFooter className="grid shrink-0 grid-cols-2 gap-3 border-t bg-popover px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <SheetClose
            render={
              <Button
                type="button"
                variant="outline"
                className="h-auto min-h-11 whitespace-normal"
              />
            }
          >
            取消
          </SheetClose>
          <Button
            type="button"
            className="h-auto min-h-11 whitespace-normal"
            onClick={() => {
              const patch = advancedFilters(draft);
              const checked = PublicPersonaQuerySchema.safeParse({
                ...requested.current,
                ...patch,
                page: 1,
              });
              if (!checked.success) {
                setDraftError(checked.error.issues[0]?.message ?? '筛选条件无效，请重置后重试');
                return;
              }
              queued.current = patch;
              setOpen(false);
            }}
          >
            查看结果
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
