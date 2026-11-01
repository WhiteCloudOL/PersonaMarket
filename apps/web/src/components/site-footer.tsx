import Link from 'next/link';
import { BrandMark } from './brand-mark';
const links = [
  ['/', '首页'],
  ['/explore', '探索人设'],
  ['/dashboard/personas/new', '发布作品'],
  ['/guides', '使用指南'],
  ['/terms', '服务条款'],
  ['/privacy', '隐私说明'],
  ['/content-policy', '投稿与转载'],
] as const;
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border/60 bg-card/40">
      <div className="mx-auto grid w-full max-w-[86rem] grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))] items-center gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <BrandMark className="size-10 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold">清蒸云鸭</p>
            <p className="mt-1 text-sm text-muted-foreground">
              让每一个有趣的灵魂，都能找到合适的相遇
            </p>
          </div>
        </div>
        <nav aria-label="页脚导航" className="grid grid-cols-2 gap-x-4 sm:grid-cols-4 lg:gap-2">
          {links.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className="flex min-h-11 items-center text-sm text-muted-foreground hover:text-primary focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring"
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-col gap-1 text-xs leading-6 text-muted-foreground">
          <p>© 2026 清蒸云鸭·人设市场</p>
          <Link
            href="/guides#license"
            className="inline-flex min-h-11 items-center hover:text-primary"
          >
            AGPL-3.0 · 为更有温度的 AI 对话而生
          </Link>
          <Link
            href="/guides#credits"
            className="inline-flex min-h-11 items-center self-start hover:text-primary focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            开源致谢
          </Link>
        </div>
      </div>
    </footer>
  );
}
