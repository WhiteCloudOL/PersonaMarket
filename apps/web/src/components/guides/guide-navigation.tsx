'use client';
import { useRef, useState } from 'react';
import { ListIcon } from 'lucide-react';
import { Button } from '@personamarket/ui/components/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from '@personamarket/ui/components/sheet';
import { guideSections } from './guide-sections';
export type GuideNavigationItem = { id: string; title: string };

function Contents({
  onSelect,
  sections,
}: {
  onSelect: (id: string) => void;
  sections: readonly GuideNavigationItem[];
}) {
  return (
    <nav aria-label="文档目录" className="flex flex-col gap-1">
      {sections.map(({ id, title }) => (
        <a
          key={id}
          href={'#' + id}
          onClick={() => onSelect(id)}
          className="flex min-h-11 min-w-0 items-center rounded-lg px-3 py-2 text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere] hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {title}
        </a>
      ))}
    </nav>
  );
}
export function GuideNavigation({
  sections = guideSections,
}: {
  sections?: readonly GuideNavigationItem[];
}) {
  const [open, setOpen] = useState(false);
  const selected = useRef<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <aside className="sticky top-16 z-30 min-w-0 self-start bg-background lg:top-28 lg:bg-transparent">
      <div className="hidden max-h-[calc(100dvh-8rem)] overflow-y-auto lg:block">
        <p className="mb-3 px-3 text-sm font-medium">本页内容</p>
        <Contents
          sections={sections}
          onSelect={(id) => document.getElementById(id)?.focus({ preventScroll: true })}
        />
      </div>
      <div className="lg:hidden">
        <Sheet
          open={open}
          onOpenChange={(next) => {
            if (next) selected.current = null;
            setOpen(next);
          }}
        >
          <SheetTrigger
            render={
              <Button
                ref={trigger}
                variant="outline"
                className="w-full justify-start"
                aria-label="打开文档目录"
              />
            }
          >
            <ListIcon aria-hidden />
            目录
          </SheetTrigger>
          <SheetContent
            side="left"
            finalFocus={() => {
              const id = selected.current;
              selected.current = null;
              return (id ? document.getElementById(id) : null) ?? trigger.current;
            }}
          >
            <SheetHeader>
              <SheetTitle>文档目录</SheetTitle>
              <SheetDescription>选择章节，跳到对应说明</SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
              <Contents
                sections={sections}
                onSelect={(id) => {
                  selected.current = id;
                  setOpen(false);
                }}
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </aside>
  );
}
