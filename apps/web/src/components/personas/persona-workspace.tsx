'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import { Badge } from '@personamarket/ui/components/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@personamarket/ui/components/card';
import { personasApi } from '@/lib/personas-api';
import { FilePlus2Icon, ArrowRightIcon } from 'lucide-react';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@personamarket/ui/components/empty';
import { FormNotice } from '../auth/auth-fields';
export function PersonaWorkspace() {
  const params = useSearchParams();
  const raw = Number(params.get('page') ?? 1);
  const page = Number.isInteger(raw) && raw >= 1 && raw <= 500 ? raw : 1;
  const query = useQuery({
    queryKey: ['private', 'personas', page],
    queryFn: () => personasApi.list(page),
    retry: false,
  });
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-sm text-muted-foreground">创作者工作台</p>
          <h1 className="text-3xl font-semibold tracking-tight">我的人设</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            每个角色都有自己的草稿，从这里继续创作
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/personas/import"
            className={buttonVariants({ variant: 'outline' })}
          >
            导入人设
          </Link>
          <Link href="/dashboard/personas/new" className={buttonVariants()}>
            创建人设
          </Link>
        </div>
      </div>
      {query.isPending ? (
        <p role="status">正在读取作品…</p>
      ) : query.isError ? (
        <>
          <FormNotice error={query.error.message} />
          <Button onClick={() => void query.refetch()}>重试作品列表</Button>
        </>
      ) : query.data.data.length === 0 ? (
        <Card>
          <Empty className="min-h-72">
            <EmptyHeader>
              <EmptyMedia className="rounded-2xl bg-accent p-4 text-primary">
                <FilePlus2Icon className="size-8" aria-hidden />
              </EmptyMedia>
              <EmptyTitle>
                <h2 className="text-xl font-semibold">为你的第一个角色写下性格</h2>
              </EmptyTitle>
              <EmptyDescription>选择 MaiBot 或 AstrBot，草稿只对你可见</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Link href="/dashboard/personas/new" className={buttonVariants()}>
                开始创作
                <ArrowRightIcon aria-hidden />
              </Link>
            </EmptyContent>
          </Empty>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {query.data.data.map((item) => (
              <Card key={item.id}>
                <CardHeader>
                  <div className="mb-3 flex flex-wrap gap-2">
                    <Badge variant="secondary">
                      {item.platform === 'maibot' ? 'MaiBot' : 'AstrBot'}
                    </Badge>
                    {item.ownerVisibility === 'hidden' && <Badge variant="outline">作者隐藏</Badge>}
                    {item.latestSubmissionStatus === 'PENDING' && (
                      <Badge className="border-highlight/30 bg-highlight/15 text-foreground">
                        新版本待审核
                      </Badge>
                    )}
                    {item.latestSubmissionStatus === 'REJECTED' && (
                      <Badge
                        variant="outline"
                        className="border-destructive/20 bg-destructive/10 text-destructive"
                      >
                        新版本需修改
                      </Badge>
                    )}
                    {item.latestSubmissionStatus === 'WITHDRAWN' && (
                      <Badge variant="outline">已撤回审核</Badge>
                    )}
                    <Badge variant="outline">
                      {item.moderationState === 'blocked'
                        ? '已封禁'
                        : item.publishedReleaseId
                          ? '有公开版本'
                          : '私有草稿'}
                    </Badge>
                  </div>
                  <CardTitle className="break-words">{item.title || '未命名人设'}</CardTitle>
                  <CardDescription>
                    更新于{' '}
                    {new Intl.DateTimeFormat('zh-CN', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(item.updatedAt))}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-3">
                  <Link
                    href={'/dashboard/personas/' + item.id + '/edit'}
                    className={buttonVariants({ variant: 'outline' })}
                  >
                    继续编辑
                  </Link>
                  <Link
                    href={'/dashboard/personas/' + item.id + '/releases'}
                    className={buttonVariants({ variant: 'ghost' })}
                  >
                    版本与审核
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
          <nav aria-label="作品分页" className="flex justify-between gap-4">
            {page > 1 ? (
              <Link href={'?page=' + (page - 1)} className="underline">
                上一页
              </Link>
            ) : (
              <span />
            )}
            {page * query.data.meta.pageSize < query.data.meta.total && (
              <Link href={'?page=' + (page + 1)} className="underline">
                下一页
              </Link>
            )}
          </nav>
        </>
      )}
    </div>
  );
}
