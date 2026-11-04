'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useSyncExternalStore, type ComponentProps } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getReviewIndicators } from '@personamarket/api-client';
import { ReviewIndicatorsResponseSchema, type AuthContextResponse } from '@personamarket/contracts';
import { ChevronDownIcon, LogOutIcon } from 'lucide-react';
import { Avatar, AvatarFallback } from '@personamarket/ui/components/avatar';
import { Badge } from '@personamarket/ui/components/badge';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@personamarket/ui/components/dropdown-menu';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@personamarket/ui/components/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@personamarket/ui/components/tabs';
import { NotificationUnreadCount } from '../notifications/menu-item';
import { checkedResponse, sessionRequestOptions } from '@/lib/auth-api';
import {
  accountNavigationGroups,
  accountRoleLabels,
  type AccountNavigationGroup,
} from './account-navigation-data';

type Account = NonNullable<AuthContextResponse['data']['account']>;
type NavigationProps = {
  account: Account;
  groups: AccountNavigationGroup[];
  pending: Record<string, boolean>;
  onLogout: () => void;
  logoutPending: boolean;
  logoutError: boolean;
};
const desktopQuery = '(min-width: 1024px)';
function subscribe(change: () => void) {
  const media = matchMedia(desktopQuery);
  media.addEventListener('change', change);
  return () => media.removeEventListener('change', change);
}
const desktopSnapshot = () => matchMedia(desktopQuery).matches;
const serverSnapshot = () => false;

function AccountTrigger({
  account,
  hasPending,
  ...props
}: { account: Account; hasPending: boolean } & ComponentProps<typeof Button>) {
  return (
    <Button
      variant="ghost"
      aria-label="打开账号菜单"
      aria-description={hasPending ? '有审核待办' : undefined}
      className="gap-2 px-1.5 lg:px-2"
      {...props}
    >
      <span className="relative shrink-0">
        <Avatar>
          <AvatarFallback>
            {Array.from(account.username).slice(0, 2).join('').toUpperCase()}
          </AvatarFallback>
        </Avatar>
        {hasPending && (
          <span
            aria-hidden
            className="absolute top-0 right-0 size-3 rounded-full bg-destructive ring-2 ring-background"
          />
        )}
      </span>
      <span className="hidden max-w-28 truncate text-sm xl:inline">我的账号</span>
      <ChevronDownIcon aria-hidden data-icon="inline-end" className="hidden lg:block" />
    </Button>
  );
}
function ReviewBadge() {
  return (
    <Badge variant="destructive" aria-hidden>
      待处理
    </Badge>
  );
}

function DesktopAccountNavigation({
  account,
  groups,
  pending,
  onLogout,
  logoutPending,
  logoutError,
}: NavigationProps) {
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <AccountTrigger account={account} hasPending={Object.values(pending).some(Boolean)} />
          }
        />
        <DropdownMenuContent align="end" className="w-64 p-2">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-3 py-2">
              <span className="block truncate text-sm font-medium text-foreground">
                {account.username}
              </span>
              <span className="mt-1 block text-xs">{accountRoleLabels[account.role]}</span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {groups
              .find((group) => group.id === 'personal')
              ?.items.map((item) => (
                <DropdownMenuItem
                  key={item.href}
                  className="min-h-11 px-3"
                  aria-label={item.label}
                  aria-describedby={
                    item.href === '/dashboard/notifications'
                      ? 'notification-count-' + account.id
                      : undefined
                  }
                  render={<Link href={item.href} />}
                >
                  <item.icon aria-hidden />
                  <span className="min-w-0 flex-1">{item.label}</span>
                  {item.href === '/dashboard/notifications' && (
                    <NotificationUnreadCount accountId={account.id} />
                  )}
                </DropdownMenuItem>
              ))}
          </DropdownMenuGroup>
          {groups.length > 1 && <DropdownMenuSeparator />}
          <DropdownMenuGroup>
            {groups
              .filter((group) => group.id !== 'personal')
              .map((group) => (
                <DropdownMenuSub key={group.id}>
                  <DropdownMenuSubTrigger
                    className="min-h-11 px-3"
                    aria-description={
                      group.items.some((item) => pending[item.href]) ? '有审核待办' : undefined
                    }
                  >
                    <group.icon aria-hidden />
                    {group.label}
                    {group.items.some((item) => pending[item.href]) && <ReviewBadge />}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="min-w-48">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
                      {group.items.map((item) => (
                        <DropdownMenuItem
                          key={item.href}
                          className="min-h-11 px-3"
                          aria-description={pending[item.href] ? '有待处理事项' : undefined}
                          render={<Link href={item.href} />}
                        >
                          <item.icon aria-hidden />
                          {item.label}
                          {pending[item.href] && <ReviewBadge />}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem className="min-h-11 px-3" disabled={logoutPending} onClick={onLogout}>
              <LogOutIcon aria-hidden />
              {logoutPending ? '正在退出…' : '退出'}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {logoutError && (
        <p
          role="alert"
          className="absolute top-full right-4 mt-2 rounded-xl border bg-card p-3 text-sm text-destructive shadow-panel"
        >
          退出失败，请重试
        </p>
      )}
    </>
  );
}

function MobileAccountLinks({
  group,
  accountId,
  pathname,
  pending,
  onNavigate,
}: {
  group: AccountNavigationGroup;
  accountId: string;
  pathname: string;
  pending: Record<string, boolean>;
  onNavigate: () => void;
}) {
  return (
    <nav aria-label={group.label + '入口'} className="flex flex-col gap-1">
      {group.items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={pathname === item.href ? 'page' : undefined}
          aria-label={item.label}
          aria-description={pending[item.href] ? '有待处理事项' : undefined}
          aria-describedby={
            item.href === '/dashboard/notifications' ? 'notification-count-' + accountId : undefined
          }
          className={buttonVariants({ variant: 'ghost', className: 'min-h-11 justify-start px-3' })}
          onNavigate={onNavigate}
        >
          <item.icon aria-hidden data-icon="inline-start" />
          <span className="min-w-0 flex-1">{item.label}</span>
          {pending[item.href] && <ReviewBadge />}
          {item.href === '/dashboard/notifications' && (
            <NotificationUnreadCount accountId={accountId} />
          )}
        </Link>
      ))}
    </nav>
  );
}

function MobileAccountNavigation({
  account,
  groups,
  pending,
  onLogout,
  logoutPending,
  logoutError,
}: NavigationProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <AccountTrigger account={account} hasPending={Object.values(pending).some(Boolean)} />
        }
      />
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
      >
        <SheetHeader>
          <SheetTitle>账号导航</SheetTitle>
          <SheetDescription className="truncate">
            {account.username} · {accountRoleLabels[account.role]}
          </SheetDescription>
        </SheetHeader>
        {groups.length > 1 ? (
          <Tabs
            defaultValue="personal"
            className="@container/account-navigation shrink-0 gap-4 px-4"
          >
            <TabsList
              className="grid w-full grid-cols-2 group-data-horizontal/tabs:h-auto @min-[20rem]/account-navigation:grid-cols-4"
              aria-label="账号任务分组"
            >
              {groups.map((group) => (
                <TabsTrigger
                  key={group.id}
                  value={group.id}
                  className="min-h-11"
                  aria-description={
                    group.items.some((item) => pending[item.href]) ? '有审核待办' : undefined
                  }
                >
                  {group.label}
                  {group.items.some((item) => pending[item.href]) && (
                    <span aria-hidden className="size-2 rounded-full bg-destructive" />
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            {groups.map((group) => (
              <TabsContent key={group.id} value={group.id}>
                <MobileAccountLinks
                  accountId={account.id}
                  group={group}
                  pathname={pathname}
                  pending={pending}
                  onNavigate={() => setOpen(false)}
                />
              </TabsContent>
            ))}
          </Tabs>
        ) : (
          <div className="px-4">
            {groups.map((group) => (
              <MobileAccountLinks
                accountId={account.id}
                key={group.id}
                group={group}
                pathname={pathname}
                pending={pending}
                onNavigate={() => setOpen(false)}
              />
            ))}
          </div>
        )}
        <SheetFooter className="border-t">
          <Button
            variant="ghost"
            className="min-h-11 justify-start px-3"
            disabled={logoutPending}
            onClick={onLogout}
          >
            <LogOutIcon aria-hidden data-icon="inline-start" />
            {logoutPending ? '正在退出…' : '退出'}
          </Button>
          {logoutError && (
            <p role="alert" className="text-sm text-destructive">
              退出失败，请重试
            </p>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function AccountNavigation({
  account,
  authenticated,
  ...logout
}: Omit<NavigationProps, 'groups' | 'pending'> & { authenticated: boolean }) {
  const desktop = useSyncExternalStore(subscribe, desktopSnapshot, serverSnapshot);
  const groups = accountNavigationGroups(account.role, authenticated, account.username);
  const identity = account.id + ':' + account.role + ':' + authenticated;
  const reviews = useQuery({
    queryKey: ['private', 'review-indicators', account.id, account.role],
    queryFn: async ({ signal }) =>
      checkedResponse(
        await getReviewIndicators({
          ...sessionRequestOptions,
          headers: { 'X-Expected-Account': account.id },
          signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
        }),
        ReviewIndicatorsResponseSchema,
      ),
    enabled: authenticated && account.role !== 'user',
    staleTime: 15000,
    refetchInterval: 30000,
    retry: false,
  });
  const pending =
    !reviews.isError && reviews.data && authenticated && account.role !== 'user'
      ? {
          '/admin/moderation': reviews.data.data.releases,
          '/admin/comments': reviews.data.data.comments,
          '/admin/profiles': reviews.data.data.profiles,
          '/admin/reports': account.role === 'admin' && reviews.data.data.reports,
        }
      : {};
  // 只挂载一种交互，跨断点关闭旧弹层，避免隐藏的 Portal 或滚动锁继续存在。
  return desktop ? (
    <DesktopAccountNavigation
      key={identity}
      account={account}
      groups={groups}
      pending={pending}
      {...logout}
    />
  ) : (
    <MobileAccountNavigation
      key={identity}
      account={account}
      groups={groups}
      pending={pending}
      {...logout}
    />
  );
}
