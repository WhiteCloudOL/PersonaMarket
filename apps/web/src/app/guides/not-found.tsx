import Link from 'next/link';
import { PageContainer, PageIntro } from '@/components/page-layout';
import { buttonVariants } from '@personamarket/ui/components/button';
export default function NotFound() {
  return (
    <PageContainer size="content">
      <div className="flex min-w-0 flex-col items-start gap-6 rounded-2xl border bg-card p-6 sm:p-9">
        <PageIntro
          eyebrow="使用指南"
          title="这篇指南暂时无法访问"
          description="章节可能正在整理，可以返回目录查看已公开内容"
        />
        <Link href="/guides" className={buttonVariants({ variant: 'outline' })}>
          返回指南目录
        </Link>
      </div>
    </PageContainer>
  );
}
