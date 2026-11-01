'use client';
import { useLayoutEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthContextResponse } from '@personamarket/contracts';
import { authQuery } from '@/lib/auth-api';

export function usePrivateResult() {
  const client = useQueryClient();
  const active = useRef(true);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const current = () =>
    client.getQueryData<AuthContextResponse>(authQuery.queryKey)?.data.account?.id;
  return {
    accountId: () => {
      const id = current();
      if (!id) throw new Error('请先登录，再继续导入，当前文件仍会保留');
      return id;
    },
    accepts: (id: string) => active.current && current() === id,
  };
}
