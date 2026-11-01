'use client';
import { XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  publicPersonaTagIds,
  type PublicPersonaQuery,
  type PublicFacets,
} from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import type { FilterRow } from './explore-filter-controls';

type AppliedFilter = {
  key: string;
  label: string;
  removeLabel: string;
  patch: Partial<PublicPersonaQuery>;
};

export function appliedExploreFilters(
  query: PublicPersonaQuery,
  facets: PublicFacets,
  rows: FilterRow[],
): AppliedFilter[] {
  const filters: AppliedFilter[] = [];
  if (query.categoryId) {
    const name =
      facets.categories.find((item) => item.id === query.categoryId)?.name ?? '未收录分类';
    filters.push({
      key: 'category',
      label: '分类：' + name,
      removeLabel: '移除分类：' + name,
      patch: { categoryId: undefined },
    });
  }
  const tags = publicPersonaTagIds(query);
  tags.forEach((id, index) => {
    const name = facets.tags.find((item) => item.id === id)?.name ?? '未收录标签 ' + (index + 1);
    const remaining = tags.filter((tag) => tag !== id);
    filters.push({
      key: 'tag-' + id,
      label: '标签：' + name,
      removeLabel: '移除标签：' + name,
      patch: { tagId: undefined, tagIds: remaining.length ? remaining.join(',') : undefined },
    });
  });
  for (const row of rows) {
    const value = query[row.key];
    if (!value || value === 'all') continue;
    const name = row.options.find((option) => option.value === value)?.label ?? value;
    filters.push({
      key: row.key,
      label: row.label + '：' + name,
      removeLabel: '移除' + row.label + '：' + name,
      patch: { [row.key]: row.key === 'publishedWithin' ? 'all' : undefined },
    });
  }
  return filters;
}

export function AppliedExploreFilters({
  filters,
  onRemove,
  children,
}: {
  filters: AppliedFilter[];
  onRemove: (patch: Partial<PublicPersonaQuery>) => void;
  children?: ReactNode;
}) {
  if (!filters.length && !children) return null;
  return (
    <div role="group" aria-label="已选筛选" className="flex min-w-0 flex-wrap gap-2">
      {filters.map((filter) => (
        <Button
          key={filter.key}
          type="button"
          variant="secondary"
          className="h-auto min-h-11 max-w-full justify-between rounded-full px-3 py-2 whitespace-normal"
          aria-label={filter.removeLabel}
          onClick={() => onRemove(filter.patch)}
        >
          <span className="min-w-0 text-left break-all">{filter.label}</span>
          <XIcon aria-hidden data-icon="inline-end" />
        </Button>
      ))}
      {children}
    </div>
  );
}
