import { SearchIcon } from 'lucide-react';
import { Input } from '@personamarket/ui/components/input';
import { Button } from '@personamarket/ui/components/button';
export function PersonaSearch({
  query = '',
  platform,
  compact = false,
  filters = {},
}: {
  query?: string;
  platform?: 'maibot' | 'astrbot';
  compact?: boolean;
  filters?: Record<string, string>;
}) {
  const id = compact ? 'header-persona-search' : 'explore-persona-search';
  return (
    <form
      action="/explore"
      method="get"
      role="search"
      aria-label={compact ? '站内搜索' : '搜索公开人设'}
      className={
        compact
          ? 'flex min-w-0 items-center gap-2'
          : 'flex min-w-0 flex-wrap items-center justify-end gap-2 rounded-xl border bg-card p-1.5 shadow-sm'
      }
    >
      <label htmlFor={id} className="sr-only">
        搜索人设、标签或作者
      </label>
      <Input
        id={id}
        name="q"
        type="search"
        autoComplete="off"
        defaultValue={query}
        maxLength={80}
        placeholder="搜索人设、标签或作者…"
        className={
          compact
            ? 'min-w-0 rounded-full'
            : 'h-11 w-auto min-w-[min(100%,12ch)] flex-1 border-0 bg-transparent text-base shadow-none focus-visible:ring-2'
        }
      />
      {platform && <input type="hidden" name="platform" value={platform} />}
      {Object.entries(filters)
        .filter(([key]) =>
          [
            'categoryId',
            'tagId',
            'tagIds',
            'model',
            'origin',
            'redistribution',
            'publishedWithin',
            'hasDialogue',
            'sort',
            'view',
          ].includes(key),
        )
        .map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
      <Button
        type="submit"
        variant={compact ? 'ghost' : 'default'}
        size={compact ? 'icon' : 'default'}
        aria-label="搜索人设"
      >
        <SearchIcon aria-hidden />
        {!compact && '搜索'}
      </Button>
    </form>
  );
}
