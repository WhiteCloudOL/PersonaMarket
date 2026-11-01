'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useSyncExternalStore, type ComponentProps } from 'react';
import type { AuthContextResponse } from '@personamarket/contracts';
import { ChevronDownIcon, LogOutIcon } from 'lucide-react';
import { Avatar, AvatarFallback } from '@personamarket/ui/components/avatar';
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
import {
  accountNavigationGroups,
  accountRoleLabels,
  type AccountNavigationGroup,
} from './account-navigation-data';

type Account = NonNullable<AuthContextResponse['data']['account']>;
type NavigationProps = {
  account: Account;
  groups: AccountNavigationGroup[];
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
  ...props
}: { account: Account } & ComponentProps<typeof Button>) {
  return (
    <Button variant="ghost" aria-label="打开账号菜单" className="gap-2 px-1.5 lg:px-2" {...props}>
      <Avatar>
        <AvatarFallback>
          {Array.from(account.username).slice(0, 2).join('').toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="hidden max-w-28 truncate text-sm xl:inline">我的账号</span>
      <ChevronDownIcon aria-hidden data-icon="inline-end" className="hidden lg:block" />
    </Button>
  );
}

function DesktopAccountNavigation({
  account,
  groups,
  onLogout,
  logoutPending,
  logoutError,
}: NavigationProps) {
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<AccountTrigger account={account} />} />
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
                  <DropdownMenuSubTrigger className="min-h-11 px-3">
                    <group.icon aria-hidden />
                    {group.label}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="min-w-48">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
                      {group.items.map((item) => (
                        <DropdownMenuItem
                          key={item.href}
                          className="min-h-11 px-3"
                          render={<Link href={item.href} />}
                        >
                          <item.icon aria-hidden />
                          {item.label}
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
  onNavigate,
}: {
  group: AccountNavigationGroup;
  accountId: string;
  pathname: string;
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
          aria-describedby={
            item.href === '/dashboard/notifications' ? 'notification-count-' + accountId : undefined
          }
          className={buttonVariants({ variant: 'ghost', className: 'min-h-11 justify-start px-3' })}
          onNavigate={onNavigate}
        >
          <item.icon aria-hidden data-icon="inline-start" />
          <span className="min-w-0 flex-1">{item.label}</span>
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
  onLogout,
  logoutPending,
  logoutError,
}: NavigationProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<AccountTrigger account={account} />} />
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
                <TabsTrigger key={group.id} value={group.id} className="min-h-11">
                  {group.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {groups.map((group) => (
              <TabsContent key={group.id} value={group.id}>
                <MobileAccountLinks
                  accountId={account.id}
                  group={group}
                  pathname={pathname}
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
}: Omit<NavigationProps, 'groups'> & { authenticated: boolean }) {
  const desktop = useSyncExternalStore(subscribe, desktopSnapshot, serverSnapshot);
  const groups = accountNavigationGroups(account.role, authenticated, account.username);
  const identity = account.id + ':' + account.role + ':' + authenticated;
  // 只挂载一种交互，跨断点关闭旧弹层，避免隐藏的 Portal 或滚动锁继续存在。
  return desktop ? (
    <DesktopAccountNavigation key={identity} account={account} groups={groups} {...logout} />
  ) : (
    <MobileAccountNavigation key={identity} account={account} groups={groups} {...logout} />
  );
}
