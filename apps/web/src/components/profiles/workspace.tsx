'use client';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@personamarket/ui/components/tabs';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@personamarket/ui/components/empty';
import { authQuery } from '@/lib/auth-api';
import { profilesApi, profilesKey } from '@/lib/profiles-api';
import { FormNotice } from '../auth/auth-fields';
import { OwnProfileEditor } from './own-editor';
import { ProfileHistory } from './history';
import { ProfileModeration } from './moderation';
const subscribe = () => () => {};

function OwnWorkspace({ accountId, username }: { accountId: string; username: string }) {
  const search = useSearchParams(),
    router = useRouter(),
    pathname = usePathname();
  const tab = search.get('tab') ?? 'edit';
  const own = useQuery({
    queryKey: [...profilesKey(accountId), 'own'],
    queryFn: ({ signal }) => profilesApi.own(accountId, signal),
    retry: false,
  });
  if (own.isPending) return <Skeleton className="h-96 w-full" />;
  if (own.isError)
    return (
      <>
        <FormNotice error={own.error} />
        <Button onClick={() => void own.refetch()}>重试读取个人资料</Button>
      </>
    );
  return (
    <Tabs
      value={['edit', 'history', 'records'].includes(tab) ? tab : 'edit'}
      onValueChange={(value) => {
        const next = new URLSearchParams(search);
        next.set('tab', String(value));
        router.replace(pathname + '?' + next, { scroll: false });
      }}
      className="min-w-0 gap-6"
    >
      <TabsList
        aria-label="个人资料分区"
        className="flex w-full max-w-full flex-wrap group-data-horizontal/tabs:h-auto sm:w-fit"
      >
        <TabsTrigger value="edit" className="min-h-11 min-w-fit flex-1">
          编辑资料
        </TabsTrigger>
        <TabsTrigger value="history" className="min-h-11 min-w-fit flex-1">
          审核历史
        </TabsTrigger>
        <TabsTrigger value="records" className="min-h-11 min-w-fit flex-1">
          处理记录
        </TabsTrigger>
      </TabsList>
      <TabsContent value="edit" keepMounted>
        <OwnProfileEditor accountId={accountId} username={username} initial={own.data.data} />
      </TabsContent>
      <TabsContent value="history">
        <ProfileHistory accountId={accountId} kind="submissions" />
      </TabsContent>
      <TabsContent value="records">
        <ProfileHistory accountId={accountId} kind="records" />
      </TabsContent>
    </Tabs>
  );
}
export function ProfilesWorkspace({ mode }: { mode: 'own' | 'moderation' }) {
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const auth = useQuery(authQuery);
  if (!hydrated || auth.isPending) return <Skeleton className="h-64 w-full" />;
  if (auth.isError)
    return (
      <>
        <FormNotice error={auth.error} />
        <Button onClick={() => void auth.refetch()}>重新确认登录状态</Button>
      </>
    );
  const account = auth.data.data.account,
    ready = auth.data.data.assurance === 'authenticated';
  if (!account || !ready)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>
            <h2>{account ? '请完成登录验证' : '请先登录'}</h2>
          </EmptyTitle>
          <EmptyDescription>个人资料与审核内容只向相应账号开放</EmptyDescription>
        </EmptyHeader>
        <Link className={buttonVariants()} href={account ? '/mfa' : '/login'}>
          {account ? '完成登录验证' : '前往登录'}
        </Link>
      </Empty>
    );
  if (mode === 'moderation' && account.role === 'user')
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>
            <h2>你没有资料审核权限</h2>
          </EmptyTitle>
          <EmptyDescription>请使用审核员或管理员账号访问</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return mode === 'own' ? (
    <OwnWorkspace key={account.id} accountId={account.id} username={account.username} />
  ) : (
    <ProfileModeration key={account.id} accountId={account.id} role={account.role} />
  );
}
