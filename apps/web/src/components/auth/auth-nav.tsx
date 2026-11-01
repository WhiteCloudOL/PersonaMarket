'use client';
import Link from 'next/link';
import { RefreshCwIcon } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { authApi, authQuery } from '@/lib/auth-api';
import { useAuthChange } from './use-auth-change';
import { AccountNavigation } from './account-navigation';
import { useHydrationReady } from '@/lib/use-hydration-ready';
export function AuthNav() {
  const hydrated = useHydrationReady();
  const query = useQuery(authQuery);
  const changed = useAuthChange();
  const logout = useMutation({
    mutationFn: authApi.logout,
    onSuccess: () => changed('/', 'logout'),
    retry: false,
  });
  if (!hydrated || query.isPending)
    return <Skeleton className="size-11 rounded-full" aria-label="正在读取登录状态" />;
  if (query.isError)
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label="重试账号状态"
        title="暂时无法读取登录状态，点击重试"
        onClick={() => void query.refetch()}
      >
        <RefreshCwIcon aria-hidden />
      </Button>
    );
  const account = query.data.data.account;
  if (!account)
    return (
      <div className="flex items-center gap-1 lg:gap-2">
        <Link className={buttonVariants({ variant: 'ghost', className: 'px-3' })} href="/login">
          登录
        </Link>
        {query.data.data.registrationAvailable && (
          <span className="hidden sm:block">
            <Link className={buttonVariants()} href="/register">
              注册
            </Link>
          </span>
        )}
      </div>
    );
  const authenticated = query.data.data.assurance === 'authenticated';
  return (
    <AccountNavigation
      account={account}
      authenticated={authenticated}
      onLogout={() => logout.mutate()}
      logoutPending={logout.isPending}
      logoutError={logout.isError}
    />
  );
}
