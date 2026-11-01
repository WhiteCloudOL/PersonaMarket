'use client';
import {
  createContext,
  use,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { HistoryIcon } from 'lucide-react';
import { Button } from '@personamarket/ui/components/button';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
} from '@personamarket/ui/components/sheet';

const CloseHistory = createContext<(() => void) | null>(null);

/** 保留原生链接的键盘和新标签页操作，只在当前页导航时收起历史面板 */
export function PublicHistoryLink(
  props: Pick<ComponentProps<typeof Link>, 'href' | 'children' | 'className' | 'aria-current'>,
) {
  const close = use(CloseHistory);
  return <Link {...props} onNavigate={() => close?.()} />;
}

function subscribeHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  window.addEventListener('popstate', onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
    window.removeEventListener('popstate', onChange);
  };
}

/** 保留原 #release-history 深链接，列表内容仍由服务端读取公开快照 */
export function PublicHistorySheet({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const hash = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash,
    () => '',
  );
  const trigger = useRef<HTMLButtonElement>(null);
  function change(next: boolean) {
    setOpen(next);
    if (!next && window.location.hash === '#release-history') {
      window.history.replaceState(
        window.history.state,
        '',
        window.location.pathname + window.location.search,
      );
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  }
  return (
    <CloseHistory value={() => change(false)}>
      <Sheet open={open || hash === '#release-history'} onOpenChange={change}>
        <SheetTrigger
          id="release-history"
          ref={trigger}
          render={<Button variant="outline" className="w-full scroll-mt-28" />}
        >
          <HistoryIcon data-icon="inline-start" aria-hidden />
          查看版本记录
        </SheetTrigger>
        <SheetContent className="gap-0 overflow-hidden sm:max-w-lg" finalFocus={trigger}>
          <SheetHeader className="border-b">
            <SheetTitle>版本记录</SheetTitle>
            <SheetDescription>保留每次发布的内容与来源声明</SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-5">
            {children}
          </div>
          <SheetFooter className="border-t">
            <SheetClose render={<Button variant="outline" />}>返回作品</SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </CloseHistory>
  );
}
