import Link from 'next/link';
import { ArrowLeftIcon } from 'lucide-react';
import { buttonVariants } from '@personamarket/ui/components/button';
import { ImportWorkspace } from '@/components/personas/import-workspace';
import { PageContainer, PageIntro } from '@/components/page-layout';
export default function Page() {
  return (
    <PageContainer size="content" className="gap-5 sm:gap-6">
      <PageIntro
        title="导入人设"
        description="先核对正文与来源，再保存为私有草稿"
        className="flex-row items-start sm:items-start"
        actions={
          <Link
            href="/dashboard/personas"
            aria-label="返回我的人设"
            className={buttonVariants({ variant: 'outline', size: 'icon' })}
          >
            <ArrowLeftIcon aria-hidden />
          </Link>
        }
      />
      <ImportWorkspace />
    </PageContainer>
  );
}
