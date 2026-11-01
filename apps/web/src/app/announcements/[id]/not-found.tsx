import Link from 'next/link';
import { PageContainer } from '@/components/page-layout';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@personamarket/ui/components/empty';
import { buttonVariants } from '@personamarket/ui/components/button';
export default function NotFound() {
  return (
    <PageContainer>
      <Empty>
        <EmptyHeader>
          <EmptyTitle>
            <h1>这条公告暂时无法访问</h1>
          </EmptyTitle>
          <EmptyDescription>可以返回公告列表查看其他公开消息</EmptyDescription>
        </EmptyHeader>
        <Link href="/announcements" className={buttonVariants({ variant: 'outline' })}>
          查看公开公告
        </Link>
      </Empty>
    </PageContainer>
  );
}
