'use client';
import { useSyncExternalStore } from 'react';
const subscribe = (changed: () => void) => {
  window.addEventListener('hashchange', changed);
  return () => window.removeEventListener('hashchange', changed);
};
export function useMailToken() {
  const fragment = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => '',
  );
  return new URLSearchParams(fragment.slice(1)).get('token') ?? '';
}
export function clearMailToken() {
  window.history.replaceState(null, '', window.location.pathname);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
