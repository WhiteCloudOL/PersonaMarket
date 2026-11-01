'use client';
import Link from 'next/link';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  MenuIcon,
  ArrowRightIcon,
  HomeIcon,
  CompassIcon,
  PlusIcon,
  BookOpenIcon,
  TrophyIcon,
  MegaphoneIcon,
} from 'lucide-react';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@personamarket/ui/components/sheet';
import { BrandMark } from './brand-mark';
import type { OptionalNavigationKey } from '@personamarket/contracts';
const fixedLinks = [
  { href: '/', label: '首页', icon: HomeIcon },
  { href: '/explore', label: '探索', icon: CompassIcon },
];
const optionalLinks = {
  rankings: { href: '/rankings', label: '排行', icon: TrophyIcon },
  publish: { href: '/dashboard/personas/new', label: '发布', icon: PlusIcon },
  guides: { href: '/guides', label: '文档', icon: BookOpenIcon },
  announcements: { href: '/announcements', label: '公告', icon: MegaphoneIcon },
};
function navigationLinks(items: OptionalNavigationKey[]) {
  return [...fixedLinks, ...items.map((key) => optionalLinks[key])];
}
export function SiteNavigation({ items }: { items: OptionalNavigationKey[] }) {
  const path = usePathname();
  const links = navigationLinks(items);
  return (
    <nav aria-label="主导航" className="site-desktop-navigation shrink-0 items-center gap-1">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          {...(link.href === '/rankings' ? { prefetch: false } : {})}
          aria-current={path === link.href ? 'page' : undefined}
          className={buttonVariants({ variant: path === link.href ? 'secondary' : 'ghost' })}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
export function MobileSiteNavigation({ items }: { items: OptionalNavigationKey[] }) {
  const path = usePathname();
  const links = navigationLinks(items);
  const [open, setOpen] = useState(false);
  return (
    <div className="site-mobile-navigation">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={<Button variant="ghost" size="icon" aria-label="打开导航" />}>
          <MenuIcon aria-hidden />
        </SheetTrigger>
        <SheetContent
          side="left"
          className="w-[min(88vw,22rem)] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        >
          <SheetHeader>
            <BrandMark className="mb-3 size-12" />
            <SheetTitle>清蒸云鸭</SheetTitle>
            <SheetDescription>发现角色，开始新的故事</SheetDescription>
          </SheetHeader>
          <nav aria-label="移动端主导航" className="flex flex-col gap-2 px-4">
            {links.map(({ icon: Icon, ...link }) => (
              <Link
                key={link.href}
                href={link.href}
                {...(link.href === '/rankings' ? { prefetch: false } : {})}
                aria-current={path === link.href ? 'page' : undefined}
                onNavigate={() => setOpen(false)}
                className={buttonVariants({
                  variant: path === link.href ? 'secondary' : 'ghost',
                  className: 'h-12 justify-start',
                })}
              >
                <Icon data-icon="inline-start" />
                {link.label}
                <ArrowRightIcon data-icon="inline-end" className="ml-auto" />
              </Link>
            ))}
          </nav>
          <div className="mx-4 mt-auto rounded-2xl bg-accent/60 p-5">
            <p className="font-semibold">每一个角色，都从灵感开始</p>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">
              选择熟悉的平台，写下属于你的故事
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
