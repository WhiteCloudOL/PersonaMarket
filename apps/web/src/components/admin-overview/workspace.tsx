'use client';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@personamarket/ui/components/empty';
import { authQuery } from '@/lib/auth-api';
import { readAdminOverview } from '@/lib/admin-overview-api';
import { FormNotice } from '../auth/auth-fields';
import { ActivityPanel, OperationsPanel, ReviewQueues } from './overview-panels';

const subscribe = () => () => {};

export function AdminOverviewWorkspace() {
  const hydrated = useSyncExternalStore(
      subscribe,
      () => true,
      () => false,
    ),
    auth = useQuery(authQuery),
    account = auth.data?.data.account;
  if (!hydrated || auth.isPending)
    return <Skeleton aria-label="正在确认登录状态" className="h-64 w-full" />;
  if (auth.isError)
    return (
      <div className="flex flex-col items-start gap-3">
        <FormNotice error={auth.error} />
        <Button onClick={() => void auth.refetch()}>重新确认登录状态</Button>
      </div>
    );
  if (!account || auth.data.data.assurance !== 'authenticated')
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{account ? '请完成登录验证' : '请先登录'}</EmptyTitle>
          <EmptyDescription>管理概览仅向有权限的账号开放</EmptyDescription>
        </EmptyHeader>
        <Link className={buttonVariants()} href={account ? '/mfa' : '/login'}>
          {account ? '完成登录验证' : '前往登录'}
        </Link>
      </Empty>
    );
  if (account.role === 'user')
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>你没有管理概览权限</EmptyTitle>
          <EmptyDescription>请使用审核员或管理员账号访问此页面</EmptyDescription>
        </EmptyHeader>
        <Link className={buttonVariants({ variant: 'outline' })} href="/dashboard/personas">
          前往创作工作台
        </Link>
      </Empty>
    );
  return <OverviewData key={account.id} accountId={account.id} />;
}
function OverviewData({ accountId }: { accountId: string }) {
  const query = useQuery({
    queryKey: ['private', 'admin-overview', accountId],
    queryFn: ({ signal }) => readAdminOverview(accountId, signal),
    retry: false,
    staleTime: 15_000,
  });
  if (query.isPending) return <Skeleton aria-label="正在读取管理概览" className="h-64 w-full" />;
  if (query.isError)
    return (
      <div className="flex flex-col items-start gap-3">
        <FormNotice error={query.error} />
        <Button onClick={() => void query.refetch()}>重新读取概览</Button>
      </div>
    );
  const data = query.data.data;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <ReviewQueues
        data={data}
        refreshAction={
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
            className="min-h-11"
          >
            {query.isFetching ? '正在刷新…' : '刷新概览'}
          </Button>
        }
      />
      {data.role === 'admin' && (
        <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(18rem,1fr)]">
          <ActivityPanel data={data} />
          <OperationsPanel data={data} />
        </div>
      )}
      <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
        {query.isFetching ? '正在读取最新统计' : '已读取最新统计'}
      </p>
    </div>
  );
}
