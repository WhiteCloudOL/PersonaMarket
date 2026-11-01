'use client';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@personamarket/ui/components/tabs';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@personamarket/ui/components/empty';
import { authQuery } from '@/lib/auth-api';
import { FormNotice } from '../auth/auth-fields';
import { NotificationInbox } from './inbox';
import { NoticeForm } from './notice-form';
import { NoticeHistory } from './notice-history';
import { NotificationDeliveryPanel } from './delivery-detail';

const subscribe = () => () => {};
export function NotificationsWorkspace({ mode }: { mode: 'own' | 'admin' }) {
  const hydrated = useSyncExternalStore(
      subscribe,
      () => true,
      () => false,
    ),
    auth = useQuery(authQuery);
  if (!hydrated || auth.isPending) return <Skeleton className="h-64 w-full" />;
  if (auth.isError)
    return (
      <>
        <FormNotice error={auth.error} />
        <Button onClick={() => void auth.refetch()}>重新确认登录状态</Button>
      </>
    );
  const account = auth.data.data.account;
  if (!account || auth.data.data.assurance !== 'authenticated')
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{account ? '请完成登录验证' : '请先登录'}</EmptyTitle>
          <EmptyDescription>登录后查看自己的通知，管理员可以发送站内通知</EmptyDescription>
        </EmptyHeader>
        <Link className={buttonVariants()} href={account ? '/mfa' : '/login'}>
          {account ? '完成登录验证' : '前往登录'}
        </Link>
      </Empty>
    );
  if (mode === 'admin' && account.role !== 'admin')
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>你没有通知管理权限</EmptyTitle>
          <EmptyDescription>请使用管理员账号访问此页面</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return mode === 'own' ? (
    <NotificationInbox key={account.id} accountId={account.id} />
  ) : (
    <div key={account.id} className="min-w-0">
      <Tabs defaultValue="history" className="min-w-0">
        <TabsList aria-label="通知管理分区" className="mb-3 h-auto flex-wrap">
          <TabsTrigger value="compose" className="min-h-11">
            写通知
          </TabsTrigger>
          <TabsTrigger value="history" className="min-h-11">
            投递记录
          </TabsTrigger>
        </TabsList>
        <TabsContent value="compose" keepMounted className="max-w-3xl">
          <NoticeForm accountId={account.id} />
        </TabsContent>
        <TabsContent value="history" keepMounted>
          <NoticeHistory accountId={account.id} />
        </TabsContent>
      </Tabs>
      <NotificationDeliveryPanel accountId={account.id} />
    </div>
  );
}
