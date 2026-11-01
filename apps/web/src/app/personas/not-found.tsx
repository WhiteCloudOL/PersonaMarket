import Link from 'next/link';
import { PageContainer } from '@/components/page-layout';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@personamarket/ui/components/empty';
import { buttonVariants } from '@personamarket/ui/components/button';
export default function NotFound() {
  return (
    <PageContainer size="reading">
      <Empty className="min-h-80 rounded-2xl border bg-card shadow-panel">
        <EmptyHeader>
          <EmptyTitle>
            <h1 className="text-2xl font-semibold sm:text-3xl">这个作品暂时无法访问</h1>
          </EmptyTitle>
          <EmptyDescription>可以回到广场，看看其他公开的人设作品</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link href="/explore" className={buttonVariants()}>
            返回人设广场
          </Link>
        </EmptyContent>
      </Empty>
    </PageContainer>
  );
}
