'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react';
import { ListIcon } from 'lucide-react';
import { Button } from '@personamarket/ui/components/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@personamarket/ui/components/sheet';
import { cn } from '@personamarket/ui/lib/utils';
import { readmeHeadings, type ReadmeHeading } from '@/lib/readme-headings';
import { SafeMarkdown } from '../personas/safe-markdown';

const subscribeReadiness = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

function navigateToHeading(event: MouseEvent<HTMLAnchorElement>, select: () => void) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return;
  event.preventDefault();
  const previous = window.location.href;
  const next = event.currentTarget.href;
  if (previous !== next) {
    window.history.pushState(null, '', next);
    window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL: previous, newURL: next }));
  }
  select();
}

function Contents({
  headings,
  documentPath,
  onSelect,
}: {
  headings: readonly ReadmeHeading[];
  documentPath: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav aria-label="规则目录" className="flex min-w-0 flex-col gap-1">
      {headings.map((heading) => (
        <a
          key={heading.id}
          href={documentPath + '#' + heading.id}
          onClick={(event) => navigateToHeading(event, () => onSelect(heading.id))}
          className="flex min-h-11 min-w-0 shrink-0 items-center rounded-lg px-3 py-2 text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere] hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          style={{ paddingInlineStart: `${Math.min(heading.depth - 1, 3) * 0.75 + 0.75}rem` }}
        >
          {heading.title}
        </a>
      ))}
    </nav>
  );
}

function PolicyContents({
  headings,
  documentPath,
  contentId,
}: {
  headings: readonly ReadmeHeading[];
  documentPath: string;
  contentId: string;
}) {
  const hydrated = useSyncExternalStore(subscribeReadiness, clientReady, serverReady);
  const [open, setOpen] = useState(false);
  const selected = useRef<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 64rem)');
    const closeAtDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener('change', closeAtDesktop);
    return () => desktop.removeEventListener('change', closeAtDesktop);
  }, []);
  return (
    <aside
      data-policy-contents
      className="sticky top-20 z-20 min-w-0 self-start bg-card lg:order-2 lg:top-28"
    >
      <div className="hidden max-h-[calc(100dvh-8rem)] overflow-y-auto overscroll-contain lg:block">
        <h2 className="mb-3 px-3 text-sm font-medium">本页内容</h2>
        <Contents
          headings={headings}
          documentPath={documentPath}
          onSelect={(id) => {
            const target = document.getElementById(id);
            target?.scrollIntoView({ block: 'start' });
            target?.focus({ preventScroll: true });
          }}
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
            disabled={!hydrated}
            render={
              <Button
                ref={trigger}
                variant="outline"
                className="h-auto min-h-11 w-full justify-start whitespace-normal text-left"
              />
            }
          >
            <ListIcon aria-hidden data-icon="inline-start" />
            规则目录
            <span aria-hidden className="text-muted-foreground">
              {headings.length}
            </span>
          </SheetTrigger>
          <SheetContent
            side="right"
            className="overflow-hidden"
            finalFocus={() => {
              const id = selected.current;
              selected.current = null;
              const target = id ? document.getElementById(id) : null;
              target?.scrollIntoView({ block: 'start' });
              return (
                target ??
                (trigger.current?.getClientRects().length
                  ? trigger.current
                  : document.getElementById(contentId))
              );
            }}
          >
            <SheetHeader>
              <SheetTitle>规则目录</SheetTitle>
              <SheetDescription>选择章节，回到这份公开规则继续阅读</SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
              <Contents
                headings={headings}
                documentPath={documentPath}
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

function usePolicyFragment(anchors: ReadonlyMap<number, string>) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    let id: string;
    try {
      id = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      return;
    }
    if (!new Set(anchors.values()).has(id)) return;
    const target = document.getElementById(id);
    if (!target || !root.current?.contains(target)) return;
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
    };
    const restore = () => {
      let current: string;
      try {
        current = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        return;
      }
      if (cancelled || current !== id || !target.isConnected) return;
      target.scrollIntoView({ block: 'start' });
      target.focus({ preventScroll: true });
    };
    const images = Array.from(root.current.querySelectorAll('img')).filter(
      (image) =>
        !image.complete &&
        Boolean(image.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING),
    );
    for (const image of images) {
      image.addEventListener('load', restore, { once: true });
      image.addEventListener('error', restore, { once: true });
    }
    const events = ['pointerdown', 'touchstart', 'wheel', 'keydown'] as const;
    for (const event of events) window.addEventListener(event, cancel, { passive: true });
    const frame = requestAnimationFrame(restore);
    void document.fonts.ready.then(restore);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      for (const event of events) window.removeEventListener(event, cancel);
      for (const image of images) {
        image.removeEventListener('load', restore);
        image.removeEventListener('error', restore);
      }
    };
  }, [anchors]);
  return root;
}

export function PolicyReader({
  text,
  publicationId,
  documentPath,
}: {
  text: string;
  publicationId: string;
  documentPath: string;
}) {
  const { headings, anchors } = useMemo(() => {
    const headings = readmeHeadings(text, publicationId);
    return { headings, anchors: new Map(headings.map((heading) => [heading.offset, heading.id])) };
  }, [text, publicationId]);
  const root = usePolicyFragment(anchors);
  const contentId = 'policy-content-' + publicationId;
  return (
    <div
      className={cn(
        'grid min-w-0 gap-5',
        headings.length > 1 && 'lg:grid-cols-[minmax(0,1fr)_14rem] lg:gap-8',
      )}
    >
      {headings.length > 1 && (
        <PolicyContents headings={headings} documentPath={documentPath} contentId={contentId} />
      )}
      <section
        ref={root}
        id={contentId}
        tabIndex={-1}
        aria-labelledby={contentId + '-title'}
        data-policy-body={publicationId}
        className="min-w-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring lg:order-1"
      >
        <h2 id={contentId + '-title'} className="sr-only">
          规则正文
        </h2>
        <SafeMarkdown
          text={text}
          imageBase="/api/v1/public/assets"
          headingMode="section"
          headingAnchors={anchors}
          className="text-base leading-8 [overflow-wrap:anywhere] [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-sm [&_ol]:flex [&_ol]:list-outside [&_ol]:flex-col [&_ol]:gap-3 [&_ol]:pl-6 [&_ul]:flex [&_ul]:list-outside [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:pl-6"
        />
      </section>
    </div>
  );
}
