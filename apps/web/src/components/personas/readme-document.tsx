'use client';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useSearchParams } from 'next/navigation';
import { IdSchema } from '@personamarket/contracts';
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
import { readmeHeadings, type ReadmeHeading } from '@/lib/readme-headings';
import { SafeMarkdown } from './safe-markdown';

const subscribeReadiness = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

function ReadmeNavigation({
  headings,
  documentPath,
}: {
  headings: readonly ReadmeHeading[];
  documentPath: string;
}) {
  const search = useSearchParams().toString();
  const hydrated = useSyncExternalStore(subscribeReadiness, clientReady, serverReady);
  const [open, setOpen] = useState(false);
  const selected = useRef<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <div className="sticky top-20 z-20 min-w-0 max-w-full self-start rounded-lg bg-card/95 p-1 shadow-xs backdrop-blur-sm">
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (next) selected.current = null;
          setOpen(next);
        }}
      >
        <SheetTrigger
          aria-label="章节目录"
          disabled={!hydrated}
          render={
            <Button
              ref={trigger}
              variant="outline"
              className="h-auto min-h-11 max-w-full whitespace-normal text-left"
            />
          }
        >
          <ListIcon aria-hidden data-icon="inline-start" />
          章节目录
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
            return target ?? trigger.current;
          }}
        >
          <SheetHeader>
            <SheetTitle>作品目录</SheetTitle>
            <SheetDescription>选择章节，回到正文继续阅读</SheetDescription>
          </SheetHeader>
          <nav
            aria-label="作品目录"
            className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-4 pt-1 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
          >
            {headings.map((heading) => (
              <a
                key={heading.id}
                href={documentPath + (search ? '?' + search : '') + '#' + heading.id}
                onClick={(event) => {
                  if (
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  )
                    return;
                  event.preventDefault();
                  const previous = window.location.href;
                  const next = event.currentTarget.href;
                  if (previous !== next) {
                    window.history.pushState(null, '', next);
                    window.dispatchEvent(
                      new HashChangeEvent('hashchange', { oldURL: previous, newURL: next }),
                    );
                  }
                  selected.current = heading.id;
                  setOpen(false);
                }}
                className="flex min-h-11 shrink-0 items-center rounded-lg px-3 py-2 text-sm leading-6 [overflow-wrap:anywhere] hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                style={{ paddingInlineStart: `${Math.min(heading.depth - 1, 3) * 0.75 + 0.75}rem` }}
              >
                {heading.title}
              </a>
            ))}
          </nav>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** 流式正文可能晚于浏览器初次hash查找，只恢复本篇合法锚点；用户操作后停止追随图片/字体布局。 */
function useReadmeFragment(anchors: ReadonlyMap<number, string>) {
  const root = useRef<HTMLDivElement>(null);
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

export function ReadmeDocument({
  text,
  releaseId,
  personaId,
}: {
  text: string;
  releaseId: string;
  personaId: string;
}) {
  const { headings, anchors } = useMemo(() => {
    const headings = readmeHeadings(text, releaseId);
    return { headings, anchors: new Map(headings.map((heading) => [heading.offset, heading.id])) };
  }, [text, releaseId]);
  const root = useReadmeFragment(anchors);
  const documentPath =
    '/personas/' + IdSchema.parse(personaId) + '/releases/' + IdSchema.parse(releaseId);
  return (
    <div ref={root} className="relative flex min-w-0 flex-col gap-4">
      {headings.length > 1 && <ReadmeNavigation headings={headings} documentPath={documentPath} />}
      <SafeMarkdown text={text} imageBase="/api/v1/public/assets" headingAnchors={anchors} />
    </div>
  );
}
