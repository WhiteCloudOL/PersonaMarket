import Link from 'next/link';
import { CompassIcon, ArrowLeftIcon } from 'lucide-react';
import { PageContainer } from '@/components/page-layout';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@personamarket/ui/components/empty';
import { buttonVariants } from '@personamarket/ui/components/button';

export default function NotFound() {
  return (
    <PageContainer size="reading" className="justify-center">
      <Empty className="min-h-96 rounded-2xl border bg-card shadow-panel">
        <EmptyHeader>
          <EmptyMedia className="rounded-2xl bg-accent p-5 text-primary">
            <CompassIcon className="size-10" aria-hidden />
          </EmptyMedia>
          <p className="text-sm font-medium text-primary">404 · 走到了故事之外</p>
          <EmptyTitle>
            <h1 className="text-2xl font-semibold sm:text-3xl">这个页面暂时找不到</h1>
          </EmptyTitle>
          <EmptyDescription>检查一下地址，或回到人设市场继续寻找喜欢的角色</EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row flex-wrap justify-center">
          <Link href="/" className={buttonVariants({ variant: 'outline' })}>
            <ArrowLeftIcon aria-hidden />
            返回首页
          </Link>
          <Link href="/explore" className={buttonVariants()}>
            探索人设
          </Link>
        </EmptyContent>
      </Empty>
    </PageContainer>
  );
}
