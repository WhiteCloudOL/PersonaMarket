'use client';
import { useEffect } from 'react';
export function useUnsavedDraft(
  dirty: boolean,
  message = '还有未保存的草稿，确定离开吗',
  retainsDraft?: (target: URL, current: URL) => boolean,
) {
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const navigate = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a') : null;
      if (
        !anchor ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        anchor.target === '_blank' ||
        anchor.download
      )
        return;
      const current = new URL(location.href);
      const url = new URL(anchor.href, current);
      if (
        (url.origin === current.origin &&
          url.pathname === current.pathname &&
          url.search === current.search) ||
        retainsDraft?.(url, current)
      )
        return;
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', navigate, true);
    return () => {
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', navigate, true);
    };
  }, [dirty, message, retainsDraft]);
}
