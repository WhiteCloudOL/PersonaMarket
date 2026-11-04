'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

export function RouteContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const previous = useRef(pathname);
  const content = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const transition = content.current?.animate([{ opacity: 0.87 }, { opacity: 1 }], {
      duration: 160,
      easing: 'ease-out',
    });
    return () => transition?.cancel();
  }, [pathname]);

  return (
    <div ref={content} className="flex min-w-0 flex-1 flex-col">
      {children}
    </div>
  );
}
