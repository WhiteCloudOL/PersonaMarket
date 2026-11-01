'use client';
import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/** 共享查询可能先由Header变热；首个hydrate仍保持服务端等待态。 */
export function useHydrationReady() {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
