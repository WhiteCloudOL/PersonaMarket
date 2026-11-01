'use client';
import { useEffect, useRef } from 'react';
import { PublicPersonaQuerySchema, type PublicPersonaQuery } from '@personamarket/contracts';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectValue,
} from '@personamarket/ui/components/select';
import { Field, FieldLabel } from '@personamarket/ui/components/field';
import { cn } from '@personamarket/ui/lib/utils';
export type FilterKey =
  'model' | 'origin' | 'redistribution' | 'publishedWithin' | 'hasDialogue' | 'featured';
export type FilterRow = {
  key: FilterKey;
  label: string;
  options: { value: string; label: string }[];
};
function useSelectionAfterClose<T>(onChange: (value: T) => void) {
  const opened = useRef(false);
  const selected = useRef<{ value: T } | null>(null);
  return {
    select(value: T) {
      if (opened.current) selected.current = { value };
      else onChange(value);
    },
    onOpenChange(open: boolean) {
      opened.current = open;
    },
    onOpenChangeComplete(open: boolean) {
      if (open || !selected.current) return;
      const value = selected.current.value;
      selected.current = null;
      // 弹层恢复焦点及可访问树后再更新路由，避免过渡中的fieldset禁用干扰清理
      onChange(value);
    },
  };
}
export function SortControl({
  value,
  pending,
  onChange,
  className,
}: {
  value: PublicPersonaQuery['sort'];
  pending: boolean;
  onChange: (value: PublicPersonaQuery['sort']) => void;
  className?: string;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef<PublicPersonaQuery['sort'] | null>(null);
  const selection = useSelectionAfterClose((next: PublicPersonaQuery['sort']) => {
    restoreFocus.current = next;
    onChange(next);
  });
  useEffect(() => {
    if (pending || restoreFocus.current !== value) return;
    // 路由更新时fieldset会禁用原生按钮，等待更新完成再恢复本次操作的焦点
    restoreFocus.current = null;
    trigger.current?.focus({ preventScroll: true });
  }, [pending, value]);
  return (
    <Select
      onOpenChange={selection.onOpenChange}
      onOpenChangeComplete={selection.onOpenChangeComplete}
      items={{
        relevance: '相关度',
        newest: '最近发布',
        updated: '最近更新',
        oldest: '最早发布',
        title: '名称排序',
        downloads: '有效导出',
        'recent-downloads': '近7天导出',
        hot: '近期热度',
        likes: '有效点赞',
        favorites: '有效收藏',
      }}
      value={value}
      onValueChange={(next) => {
        const checked = PublicPersonaQuerySchema.shape.sort.safeParse(next);
        if (checked.success) selection.select(checked.data);
      }}
    >
      <SelectTrigger
        ref={trigger}
        aria-label="结果排序"
        className={cn('w-36 min-w-0 max-w-full lg:w-40', className)}
      >
        <SelectValue className="min-w-0" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="relevance">相关度</SelectItem>
          <SelectItem value="newest">最近发布</SelectItem>
          <SelectItem value="updated">最近更新</SelectItem>
          <SelectItem value="oldest">最早发布</SelectItem>
          <SelectItem value="title">名称排序</SelectItem>
          <SelectItem value="downloads">有效导出</SelectItem>
          <SelectItem value="recent-downloads">近7天导出</SelectItem>
          <SelectItem value="hot">近期热度</SelectItem>
          <SelectItem value="likes">有效点赞</SelectItem>
          <SelectItem value="favorites">有效收藏</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
export function FilterSelect({
  row,
  value,
  scope,
  onChange,
}: {
  row: FilterRow;
  value: string | undefined;
  scope: string;
  onChange: (value: string | undefined) => void;
}) {
  const id = scope + '-' + row.key;
  const selection = useSelectionAfterClose(onChange);
  return (
    <Field>
      <FieldLabel htmlFor={id}>{row.label}</FieldLabel>
      <Select
        onOpenChange={selection.onOpenChange}
        onOpenChangeComplete={selection.onOpenChangeComplete}
        value={value ?? '__all'}
        items={Object.fromEntries([
          ['__all', '全部'],
          ...row.options.map((option) => [option.value, option.label]),
        ])}
        onValueChange={(selected) => {
          if (typeof selected === 'string')
            selection.select(selected === '__all' ? undefined : selected);
        }}
      >
        <SelectTrigger id={id} aria-label={row.label + '筛选'} className="w-full min-w-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-w-[min(90vw,28rem)]">
          <SelectGroup>
            <SelectItem value="__all">全部</SelectItem>
            {row.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <span className="min-w-0 whitespace-normal break-all leading-6">
                  {option.label}
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}
