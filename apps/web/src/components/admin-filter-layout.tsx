'use client';
import { useSyncExternalStore, type ReactNode } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { Button } from '@personamarket/ui/components/button';
import { Badge } from '@personamarket/ui/components/badge';
import { FieldGroup } from '@personamarket/ui/components/field';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@personamarket/ui/components/collapsible';

const desktopQuery = '(min-width: 1024px)';
function subscribe(change: () => void) {
  const media = matchMedia(desktopQuery);
  media.addEventListener('change', change);
  return () => media.removeEventListener('change', change);
}
const desktopSnapshot = () => matchMedia(desktopQuery).matches;
const serverSnapshot = () => false;

/** 常用条件在桌面直接呈现；手机与低频条件共用保留挂载的展开区 */
export function AdminFilterLayout({
  search,
  common,
  submit,
  children,
  expanded,
  onExpandedChange,
  appliedCount,
}: {
  search: ReactNode;
  common: ReactNode;
  submit: ReactNode;
  children: ReactNode;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  appliedCount: number;
}) {
  const desktop = useSyncExternalStore(subscribe, desktopSnapshot, serverSnapshot);
  return (
    <div className="@container/admin-filters min-w-0">
      <Collapsible
        open={expanded}
        onOpenChange={onExpandedChange}
        className="flex min-w-0 flex-col gap-4"
      >
        <FieldGroup className="grid min-w-0 items-end gap-3 sm:grid-cols-2 @min-[60rem]/admin-filters:grid-cols-[minmax(0,1fr)_9rem_9rem_auto_auto]">
          <div className="col-span-full min-w-0 @min-[60rem]/admin-filters:col-span-1">
            {search}
          </div>
          {desktop && common}
          <div className="col-span-full grid min-w-0 gap-3 @min-[15rem]/admin-filters:grid-cols-2 @min-[60rem]/admin-filters:contents">
            {submit}
            <CollapsibleTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto min-h-11 whitespace-normal py-2"
                />
              }
              aria-label={expanded ? '收起筛选' : '更多筛选'}
            >
              {expanded ? '收起筛选' : '更多筛选'}
              {appliedCount > 0 && (
                <Badge variant="secondary" aria-hidden>
                  {appliedCount}
                </Badge>
              )}
              <ChevronDownIcon data-icon="inline-end" aria-hidden />
            </CollapsibleTrigger>
          </div>
        </FieldGroup>
        <CollapsibleContent keepMounted>
          <FieldGroup className="grid min-w-0 gap-4 border-t pt-4 sm:grid-cols-2 xl:grid-cols-3">
            {!desktop && common}
            {children}
          </FieldGroup>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
