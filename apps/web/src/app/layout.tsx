import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import '@personamarket/ui/styles/globals.css';
import { cookies } from 'next/headers';
import { Providers } from '@/components/providers';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { RouteContent } from '@/components/route-content';
import { PublicMaintenanceNotice } from '@/components/system/public-maintenance-notice';
import { readThemePreference } from '@/lib/theme-preference';

export const metadata: Metadata = {
  title: '清蒸云鸭·人设市场',
  description: '创作、分享与发现 MaiBot 和 AstrBot 人设',
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const theme = readThemePreference((await cookies()).get('theme')?.value);
  return (
    <html lang="zh-CN" className={theme}>
      <body className="flex min-h-dvh flex-col">
        <Providers>
          <SiteHeader />
          <Suspense fallback={null}>
            <PublicMaintenanceNotice />
          </Suspense>
          <RouteContent>{children}</RouteContent>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
