'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { Alert, AlertTitle, AlertDescription } from '@personamarket/ui/components/alert';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import { PageContainer } from '@/components/page-layout';

export function PolicyError({ retry }: { retry: () => void }) {
  const [pending, startTransition] = useTransition();
  return (
    <PageContainer size="reading" className="justify-center">
      <Alert variant="destructive">
        <AlertTitle>
          <h1 className="text-xl font-semibold">暂时无法读取公开规则</h1>
        </AlertTitle>
        <AlertDescription>连接暂时不可用，请重试以获取当前公开版本</AlertDescription>
      </Alert>
      <div className="flex flex-wrap gap-3" aria-busy={pending}>
        <Button disabled={pending} onClick={() => startTransition(() => retry())}>
          {pending ? '正在重新读取…' : '重新加载'}
        </Button>
        <Link href="/" className={buttonVariants({ variant: 'outline' })}>
          返回首页
        </Link>
      </div>
      <p role="status" className="sr-only">
        {pending ? '正在重新读取公开规则…' : ''}
      </p>
    </PageContainer>
  );
}
