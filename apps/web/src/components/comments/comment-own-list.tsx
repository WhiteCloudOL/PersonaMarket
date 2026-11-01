'use client';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@personamarket/ui/components/button';
import { Badge } from '@personamarket/ui/components/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@personamarket/ui/components/card';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@personamarket/ui/components/empty';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { commentsApi, ownCommentsKey } from '@/lib/comments-api';
import { commentPage } from '@/lib/comments-state';
import { FormNotice } from '../auth/auth-fields';
import { CommentPagination } from './comment-pagination';
import { commentStatusLabels } from './comment-manage';

export function CommentOwnList({
  personaId,
  accountId,
  onManage,
}: {
  personaId: string;
  accountId: string;
  onManage: (id: string) => void;
}) {
  const search = useSearchParams();
  const page = commentPage(search.get('myCommentsPage'));
  const query = useQuery({
    queryKey: [...ownCommentsKey(accountId, personaId), 'list', page],
    queryFn: ({ signal }) => commentsApi.own(accountId, personaId, page, signal),
    retry: false,
  });
  return (
    <Card id="my-comments" className="min-w-0">
      <CardHeader>
        <CardTitle>
          <h3>我的评论</h3>
        </CardTitle>
        <CardDescription>待审文本和审核说明仅你自己可见</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        {query.isPending && <Skeleton className="h-32 w-full" />}
        <FormNotice error={query.error} />
        {query.isError && (
          <Button variant="outline" onClick={() => void query.refetch()}>
            重新读取我的评论
          </Button>
        )}
        {query.data?.data.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>还没有你的评论</EmptyTitle>
              <EmptyDescription>分享使用体验，审核状态会显示在这里</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {query.data?.data.map((row) => (
          <article
            key={row.id}
            className="flex min-w-0 flex-col gap-3 rounded-xl border p-4"
            aria-label="我的评论记录"
          >
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{commentStatusLabels[row.latest.status]}</Badge>
              {row.parentId && <Badge variant="outline">回复</Badge>}
              {row.visibility === 'hidden' && <Badge variant="outline">已隐藏</Badge>}
            </div>
            <p className="line-clamp-3 whitespace-pre-wrap text-sm leading-7 [overflow-wrap:anywhere]">
              {row.latest.body}
            </p>
            {row.latest.status === 'PENDING' && row.published && (
              <p className="text-sm text-muted-foreground">旧获批文本仍公开展示</p>
            )}
            <Button
              variant="outline"
              onClick={() => onManage(row.id)}
              aria-label={'管理评论：' + Array.from(row.latest.body).slice(0, 24).join('')}
            >
              查看与管理
            </Button>
          </article>
        ))}
        {query.data && (
          <CommentPagination
            page={page}
            pageSize={query.data.meta.pageSize}
            total={query.data.meta.total}
            parameter="myCommentsPage"
            label="我的评论分页"
            pending={query.isFetching}
          />
        )}
      </CardContent>
    </Card>
  );
}
