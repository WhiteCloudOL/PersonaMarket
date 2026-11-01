import Link from 'next/link';
import { cookies } from 'next/headers';
import { SearchIcon } from 'lucide-react';
import { AuthNav } from './auth/auth-nav';
import { ThemeToggle } from './theme-toggle';
import { readPublicBrand } from '@/lib/site-data';
import { readSiteHome } from '@/lib/public-home';
import { SiteNavigation, MobileSiteNavigation } from './site-navigation';
import { BrandMark } from './brand-mark';
import { PersonaSearch } from './persona-search';
import { buttonVariants } from '@personamarket/ui/components/button';
import { readThemePreference } from '@/lib/theme-preference';

export async function SiteHeader() {
  const [jar, brand, home] = await Promise.all([cookies(), readPublicBrand(), readSiteHome()]);
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-60 focus:rounded-lg focus:bg-card focus:p-4 focus:ring-2 focus:ring-ring"
      >
        跳至主要内容
      </a>
      <header
        data-site-header
        className="sticky top-0 z-40 w-full border-b border-border/70 bg-background/95 backdrop-blur-md lg:top-3 lg:mx-auto lg:mt-3 lg:w-[calc(100%-3rem)] lg:max-w-[84rem] lg:rounded-2xl lg:border lg:bg-card/95 lg:shadow-panel"
      >
        <div className="mx-auto flex h-16 max-w-[84rem] flex-nowrap items-center gap-2 px-4 lg:gap-6 lg:px-5">
          <Link
            href="/"
            aria-label={brand?.data.name ?? '清蒸云鸭·人设市场'}
            className="flex min-h-11 min-w-0 items-center gap-2 lg:max-w-56 lg:shrink-0"
          >
            <BrandMark className="size-8 shrink-0 lg:size-10" />
            <span className="truncate text-base font-bold tracking-tight lg:text-xl">
              {brand?.data.name && brand.data.name !== '清蒸云鸭·人设市场'
                ? brand.data.name
                : '清蒸云鸭'}
            </span>
          </Link>
          <SiteNavigation items={home?.data.navigation ?? []} />
          <div className="ml-auto hidden min-w-0 max-w-72 flex-1 xl:block">
            <PersonaSearch compact />
          </div>
          {/* 工具栏保持44px以上命中区域，文字随用户字号放大，图标间距不成倍挤占手机宽度 */}
          <div className="ml-auto flex shrink-0 items-center gap-1 [--spacing:4px] [&_[data-slot=avatar]]:size-9 xl:ml-0 lg:gap-2">
            <Link
              href="/explore"
              aria-label="搜索人设"
              className={buttonVariants({ variant: 'ghost', size: 'icon', className: 'xl:hidden' })}
            >
              <SearchIcon aria-hidden />
            </Link>
            <nav aria-label="账号导航">
              <AuthNav />
            </nav>
            <ThemeToggle initialTheme={readThemePreference(jar.get('theme')?.value)} />
            <MobileSiteNavigation items={home?.data.navigation ?? []} />
          </div>
        </div>
      </header>
    </>
  );
}
