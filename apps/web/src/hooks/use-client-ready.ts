'use client';
import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

/** SSR明确禁用脚本交互，接管后再启用，避免首次操作被吞掉 */
export function useClientReady() {
  return useSyncExternalStore(subscribe, clientReady, serverReady);
}
