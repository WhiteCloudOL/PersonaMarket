'use client';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { AuthContextResponseSchema, type AuthContextResponse } from '@personamarket/contracts';
import { authQuery, readAuthContext } from '@/lib/auth-api';
import { subscribeAuthSession } from '@/lib/auth-session-events';

export function AuthSessionSync({ onIdentityChange }: { onIdentityChange: () => void }) {
  const client = useQueryClient();
  const router = useRouter();
  const previous = useRef<AuthContextResponse['data']['account']>(null);
  useEffect(() => {
    let generation = 0;
    let logoutPending = false;
    const account = () => {
      const parsed = AuthContextResponseSchema.safeParse(client.getQueryData(authQuery.queryKey));
      return parsed.success ? parsed.data.data.account : null;
    };
    previous.current ??= account();
    const clearPrivate = () => {
      void client.cancelQueries({ queryKey: ['private'] });
      void client.resetQueries({ queryKey: ['private'] });
      client.getMutationCache().clear();
      onIdentityChange();
    };
    const unwatch = client.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] !== authQuery.queryKey[0]) return;
      const next = account();
      if (!next) return; // 会话过期时保留未保存输入，重新登录同一账号可以继续
      const changed =
        previous.current &&
        (previous.current.id !== next.id || previous.current.role !== next.role);
      previous.current = next;
      if (changed) {
        clearPrivate();
        router.refresh();
      }
    });
    const refresh = async (reason: 'refresh' | 'logout') => {
      if (reason === 'logout') logoutPending = true;
      const revision = ++generation;
      try {
        if (client.getQueryData(authQuery.queryKey) !== undefined)
          await client.cancelQueries({ queryKey: authQuery.queryKey });
        if (revision !== generation) return;
        const context = await readAuthContext();
        if (revision !== generation) return;
        const explicitLogout = logoutPending && previous.current && !context.data.account;
        logoutPending = false;
        if (explicitLogout) {
          previous.current = null;
          clearPrivate();
        }
        client.setQueryData(authQuery.queryKey, context);
        if (explicitLogout) {
          router.replace('/');
          router.refresh();
        }
      } catch {
        // 短暂网络失败不清空本地输入，下一次会话通知或回到页面时重新读取
      }
    };
    const unsubscribe = subscribeAuthSession((reason, local) => {
      if (local) {
        generation++;
        logoutPending = false;
        previous.current = null;
        clearPrivate();
      } else void refresh(reason);
    });
    const focus = () => void refresh('refresh');
    const visible = () => {
      if (document.visibilityState === 'visible') focus();
    };
    window.addEventListener('focus', focus);
    window.addEventListener('pageshow', focus);
    document.addEventListener('visibilitychange', visible);
    return () => {
      generation++;
      unwatch();
      unsubscribe();
      window.removeEventListener('focus', focus);
      window.removeEventListener('pageshow', focus);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [client, router, onIdentityChange]);
  return null;
}
