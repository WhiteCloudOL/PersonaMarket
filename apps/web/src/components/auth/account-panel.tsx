'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@personamarket/ui/components/card';
import { Badge } from '@personamarket/ui/components/badge';
import { authApi, authQuery } from '@/lib/auth-api';
import { FormNotice } from './auth-fields';
import { useAuthChange } from './use-auth-change';
import { MonitorIcon, SmartphoneIcon, MailIcon } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@personamarket/ui/components/tabs';
import { cn } from '@personamarket/ui/lib/utils';
import { Avatar, AvatarFallback } from '@personamarket/ui/components/avatar';
import { deviceSummary } from '@/lib/device-summary';
import { EmailVerificationNotice } from './email-verification-notice';
import { useHydrationReady } from '@/lib/use-hydration-ready';
import { AccountSecurity } from './account-security';
import { MfaForm } from './mfa-form';
import { AdminBrandForm } from './admin-brand-form';

const accountTabs = [
  { value: 'devices', label: '设备会话' },
  { value: 'mfa', label: '二次验证' },
  { value: 'security', label: '密码与邮箱' },
  { value: 'site', label: '站点设置' },
] as const;

export function AccountPanel() {
  const hydrated = useHydrationReady();
  const context = useQuery(authQuery);
  const client = useQueryClient();
  const changed = useAuthChange();
  const params = useSearchParams();
  const [visited, setVisited] = useState<string[]>([]);
  const ready = context.data?.data.assurance === 'authenticated';
  const admin = context.data?.data.account?.role === 'admin';
  const tabs = accountTabs.filter((tab) => tab.value !== 'site' || admin);
  const activeTab = tabs.find((tab) => tab.value === params.get('tab'))?.value ?? 'devices';
  if (!visited.includes(activeTab)) setVisited([...visited, activeTab]);
  const sessions = useQuery({
    queryKey: ['private', 'sessions', context.data?.data.account?.id],
    queryFn: authApi.sessions,
    enabled: ready && activeTab === 'devices',
    retry: false,
  });
  const logoutAll = useMutation({
    mutationFn: authApi.logoutAll,
    onSuccess: () => changed('/login', 'logout'),
    retry: false,
  });
  const revoke = useMutation({
    mutationFn: ({ id }: { id: string; current: boolean }) => authApi.revoke(id),
    onSuccess: (_, session) =>
      session.current
        ? changed('/login', 'logout')
        : client.invalidateQueries({ queryKey: ['private', 'sessions'] }),
    retry: false,
  });
  if (!hydrated || context.isPending) return <p role="status">正在读取账号信息…</p>;
  if (context.isError) return <FormNotice error="无法读取账号信息，请刷新后重试" />;
  const account = context.data.data.account;
  if (!account)
    return (
      <Link href="/login" className={buttonVariants()}>
        登录后管理账号
      </Link>
    );
  if (!ready)
    return (
      <Link href="/mfa" className={buttonVariants()}>
        完成二次验证后继续
      </Link>
    );
  return (
    <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[19rem_minmax(0,1fr)]">
      <Card className="lg:sticky lg:top-28">
        <CardHeader>
          <CardTitle>
            <h2>你的账号</h2>
          </CardTitle>
          <CardDescription>查看身份与邮箱验证状态</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Avatar className="size-16 rounded-2xl">
            <AvatarFallback className="rounded-2xl text-xl">
              {Array.from(account.username).slice(0, 2).join('').toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <p className="break-all text-xl font-semibold">{account.username}</p>
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <MailIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="break-all">{account.email}</span>
          </p>
          <Badge className="w-fit" variant={account.emailVerified ? 'secondary' : 'outline'}>
            {account.emailVerified ? '邮箱已验证' : '邮箱待验证'}
          </Badge>
          {!account.emailVerified && (
            <EmailVerificationNotice
              key={account.id}
              accountId={account.id}
              email={account.email}
            />
          )}
        </CardContent>
      </Card>
      <Tabs
        key={account.id}
        value={activeTab}
        className="min-w-0 gap-4"
        onValueChange={(value) => {
          if (value === activeTab || !tabs.some((tab) => tab.value === value)) return;
          const query = new URLSearchParams(params);
          if (value === 'devices') query.delete('tab');
          else query.set('tab', value);
          const search = query.toString();
          window.history.pushState(null, '', '/account' + (search ? '?' + search : ''));
        }}
      >
        <TabsList
          aria-label="账号管理"
          className={cn(
            'w-full justify-start gap-1 group-data-horizontal/tabs:h-auto',
            admin ? 'grid grid-cols-2 sm:grid-cols-4' : 'flex flex-wrap',
          )}
        >
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="h-auto min-h-11 min-w-0 flex-1 basis-24 whitespace-normal px-3 py-2"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="devices">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>设备会话</h2>
              </CardTitle>
              <CardDescription>查看登录设备，随时撤销不再使用的会话</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {sessions.isPending ? (
                <p role="status">正在读取设备…</p>
              ) : sessions.isError ? (
                <>
                  <FormNotice error="无法读取设备会话" />
                  <Button variant="outline" onClick={() => void sessions.refetch()}>
                    重试
                  </Button>
                </>
              ) : sessions.data.data.length ? (
                <ul className="flex flex-col gap-4">
                  {sessions.data.data.map((session) => {
                    const device = deviceSummary(session.deviceName);
                    const Icon = device.mobile ? SmartphoneIcon : MonitorIcon;
                    return (
                      <li
                        key={session.id}
                        className="flex min-w-0 flex-col gap-4 rounded-xl border bg-background/50 p-4"
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
                            <Icon className="size-5" aria-hidden />
                          </span>
                          <div className="flex min-w-0 flex-1 flex-col gap-2">
                            <p className="break-words font-medium">{device.label}</p>
                            <Badge
                              variant={session.current ? 'secondary' : 'outline'}
                              className="w-fit"
                            >
                              {session.current ? '当前设备' : '其他设备'}
                            </Badge>
                          </div>
                        </div>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <p className="text-xs leading-6 text-muted-foreground">
                            到期{' '}
                            {new Date(session.expiresAt).toLocaleString('zh-CN', {
                              timeZone: 'Asia/Shanghai',
                            })}
                            （北京时间）
                          </p>
                          <Button
                            variant="outline"
                            disabled={revoke.isPending}
                            onClick={() => revoke.mutate(session)}
                          >
                            退出此设备
                          </Button>
                        </div>
                        <details className="min-w-0 border-t pt-2 text-xs text-muted-foreground">
                          <summary className="flex min-h-11 cursor-pointer items-center underline-offset-4 hover:underline">
                            设备详细信息
                          </summary>
                          <p className="break-all leading-6">
                            {session.deviceName || '此设备未提供浏览器信息'}
                          </p>
                          <p className="mt-2 leading-6">
                            登录于{' '}
                            {new Date(session.createdAt).toLocaleString('zh-CN', {
                              timeZone: 'Asia/Shanghai',
                            })}
                            （北京时间）
                          </p>
                        </details>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">没有有效设备会话</p>
              )}
              <FormNotice error={revoke.error?.message ?? logoutAll.error?.message} />
              <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm leading-6 text-muted-foreground">
                  在共用设备上登录后，可在这里统一退出
                </p>
                <Button
                  variant="outline"
                  disabled={logoutAll.isPending}
                  onClick={() => logoutAll.mutate()}
                >
                  退出全部设备
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="mfa">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>二次验证</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <MfaForm mode="manage" />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="security" keepMounted={visited.includes('security')}>
          <AccountSecurity />
        </TabsContent>
        {admin && (
          <TabsContent value="site" keepMounted={visited.includes('site')}>
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>站点展示</h2>
                </CardTitle>
                <CardDescription>名称与简介会出现在首页和导航中</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <AdminBrandForm />
                <Link
                  href="/admin/settings/brand"
                  className={buttonVariants({ variant: 'outline', className: 'w-fit' })}
                >
                  更多站点管理设置
                </Link>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
