'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  createContext,
  use,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  SettingsIcon,
  PaletteIcon,
  MailIcon,
  UsersIcon,
  PenLineIcon,
  ChevronDownIcon,
  HeartIcon,
  HomeIcon,
  ListIcon,
  ArrowLeftRightIcon,
  ImageIcon,
  ChartNoAxesColumnIncreasingIcon,
  BookOpenCheckIcon,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@personamarket/ui/components/sheet';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@personamarket/ui/components/input';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import { authQuery } from '@/lib/auth-api';
import { FormNotice } from '../auth/auth-fields';
const DirtyContext = createContext<{ dirty: boolean; setDirty: (dirty: boolean) => void } | null>(
  null,
);
const subscribeHydration = () => () => {};
export function useSettingsDirty(dirty: boolean) {
  const context = use(DirtyContext);
  const setDirty = context?.setDirty;
  useEffect(() => {
    setDirty?.(dirty);
    return () => setDirty?.(false);
  }, [dirty, setDirty]);
}
function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  const context = use(DirtyContext);
  const [search, setSearch] = useState('');
  const searchId = useId();
  const activeLink = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const link = activeLink.current;
    const scroller = link?.closest('aside');
    if (!link || !scroller) return;
    const frame = scroller.getBoundingClientRect();
    if (!frame.height) return;
    const target = link.getBoundingClientRect();
    const inset = Number.parseFloat(getComputedStyle(scroller).paddingTop) || 8;
    // 只移动设置侧栏，避免选择分组时把正在编辑的正文滚离当前位置。
    if (target.top < frame.top + inset) scroller.scrollTop += target.top - frame.top - inset;
    else if (target.bottom > frame.bottom - inset)
      scroller.scrollTop += target.bottom - frame.bottom + inset;
  }, [path, search]);
  const groups = [
    { href: '/admin/settings/brand', label: '站点品牌', icon: PaletteIcon },
    { href: '/admin/settings/home', label: '首页展示', icon: HomeIcon },
    { href: '/admin/settings/model-suggestions', label: '模型建议', icon: ListIcon },
    { href: '/admin/settings/mail', label: '邮件服务 SMTP', icon: MailIcon },
    { href: '/admin/settings/accounts', label: '注册与会话', icon: UsersIcon },
    { href: '/admin/settings/creation', label: '创作与投稿', icon: PenLineIcon },
    { href: '/admin/settings/transfer', label: '导入导出', icon: ArrowLeftRightIcon },
    { href: '/admin/settings/media', label: '文件与图片', icon: ImageIcon },
    { href: '/admin/settings/community', label: '社区互动', icon: HeartIcon },
    {
      href: '/admin/settings/rankings',
      label: '排行与运营',
      icon: ChartNoAxesColumnIncreasingIcon,
    },
    { href: '/admin/settings/policies', label: '公共规则', icon: BookOpenCheckIcon },
    { href: '/admin/settings/system', label: '维护与系统', icon: SettingsIcon },
  ].filter((group) => group.label.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <div className="flex flex-col gap-4">
      <label className="sr-only" htmlFor={searchId}>
        搜索设置
      </label>
      <Input
        id={searchId}
        type="search"
        name="settings-search"
        autoComplete="off"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="搜索设置…"
      />
      <nav aria-label="设置分组" className="flex flex-col items-stretch gap-2">
        {groups.map(({ icon: Icon, ...group }) => (
          <Link
            key={group.href}
            ref={path === group.href ? activeLink : undefined}
            href={group.href}
            aria-current={path === group.href ? 'page' : undefined}
            className={buttonVariants({
              variant: path === group.href ? 'secondary' : 'ghost',
              className: 'justify-start',
            })}
            onNavigate={(event) => {
              if (path === group.href) {
                event.preventDefault();
                onNavigate?.();
                return;
              }
              if (context?.dirty && !window.confirm('有未保存的设置，确定离开吗')) {
                event.preventDefault();
                return;
              }
              onNavigate?.();
            }}
          >
            <Icon aria-hidden />
            {group.label}
          </Link>
        ))}
        {groups.length === 0 && <p className="text-sm text-muted-foreground">没有找到匹配的设置</p>}
      </nav>
    </div>
  );
}
export function SettingsAccess({ children }: { children: React.ReactNode }) {
  // Header可能先完成认证查询；首次客户端渲染仍与服务端的等待状态一致
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );
  const query = useQuery(authQuery);
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ dirty, setDirty }), [dirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  if (!hydrated || query.isPending) return <p role="status">正在校验管理员身份…</p>;
  if (query.isError)
    return (
      <div className="flex flex-col gap-3">
        <FormNotice error="无法校验账号，请重试" />
        <Button onClick={() => void query.refetch()}>重试</Button>
      </div>
    );
  if (query.data.data.account?.role !== 'admin') return <FormNotice error="此页面需要管理员权限" />;
  if (query.data.data.assurance !== 'authenticated')
    return (
      <Link href="/mfa" className="underline">
        完成二次验证后继续
      </Link>
    );
  return (
    <DirtyContext value={value}>
      <div className="grid items-start gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="hidden flex-col gap-5 rounded-2xl border bg-card p-4 shadow-panel lg:sticky lg:top-28 lg:flex lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto lg:overscroll-contain">
          <p className="flex items-center gap-2 px-2 py-1 font-medium">
            <SettingsIcon className="size-5 text-primary" aria-hidden />
            网站设置
          </p>
          <Navigation />
        </aside>
        <div className="lg:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger render={<Button variant="outline" className="w-full justify-between" />}>
              <span className="flex items-center gap-2">
                <SettingsIcon aria-hidden />
                选择设置分组
              </span>
              <ChevronDownIcon aria-hidden />
            </SheetTrigger>
            <SheetContent side="bottom" className="max-h-[85dvh] rounded-t-2xl">
              <SheetHeader>
                <SheetTitle>网站设置</SheetTitle>
                <SheetDescription>选择需要管理的设置分组</SheetDescription>
              </SheetHeader>
              <div className="overflow-y-auto px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
                <Navigation onNavigate={() => setOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    </DirtyContext>
  );
}
