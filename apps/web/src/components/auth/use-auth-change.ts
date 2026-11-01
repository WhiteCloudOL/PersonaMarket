'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { authQuery } from '@/lib/auth-api';
import { announceAuthSession } from '@/lib/auth-session-events';
export function useAuthRefresh() {
  const client = useQueryClient();
  return async (reason: 'refresh' | 'logout' = 'refresh') => {
    await client.cancelQueries();
    client.removeQueries({
      predicate: (query) => query.queryKey[0] !== 'auth-context' && query.queryKey[0] !== 'public',
    });
    await client.resetQueries({ queryKey: authQuery.queryKey });
    const context = await client.fetchQuery(authQuery);
    if (reason === 'logout') client.getMutationCache().clear();
    announceAuthSession(reason);
    return context;
  };
}
export function useAuthChange() {
  const refresh = useAuthRefresh();
  const router = useRouter();
  return async (destination?: string, reason?: 'logout') => {
    const context = await refresh(reason);
    const target =
      context.data.assurance === 'authenticated' || reason === 'logout'
        ? (destination ?? '/account')
        : context.data.assurance === 'anonymous'
          ? '/login'
          : '/mfa' + (destination ? '?returnTo=' + encodeURIComponent(destination) : '');
    router.replace(target);
    router.refresh();
  };
}
