import Link from 'next/link';
import { FileTextIcon } from 'lucide-react';
import type { PolicySlug } from '@personamarket/contracts';
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
import { policyLabels } from './policy-labels';

export function PolicyUnavailable({ slug }: { slug: PolicySlug }) {
  return (
    <PageContainer size="reading" className="justify-center">
      <Empty className="min-h-80 border bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileTextIcon aria-hidden />
          </EmptyMedia>
          <EmptyTitle>
            <h1 className="text-2xl leading-snug font-semibold">
              这份{policyLabels[slug]}暂时无法访问
            </h1>
          </EmptyTitle>
          <EmptyDescription>
            规则可能尚未公开、已经下线或版本已更新，可以重新查看当前公开版
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="sm:flex-row sm:justify-center">
          <a
            href={'/' + slug}
            className={buttonVariants({
              variant: 'outline',
              className: 'h-auto min-h-11 whitespace-normal text-center',
            })}
          >
            查看当前公开版
          </a>
          <Link href="/" className={buttonVariants({ variant: 'ghost' })}>
            返回首页
          </Link>
        </EmptyContent>
      </Empty>
    </PageContainer>
  );
}
